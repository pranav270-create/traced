from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import text, select, func, and_, or_
from sqlalchemy.orm import selectinload
from typing import List
import uuid
import json

from traced.backend.schemas.eval_schemas import FeedbackAssignment, FeedbackSchemaCreate, FeedbackTemplateCreate
from traced.core.logger_model import FeedbackModel, Row, feedback_assignments, FeedbackTemplate, Experiment
from traced.core.logger_model import User
from traced.backend.routers.experiment_router import build_span_tree
# from src.ingestion.alerts.gmail import gmail_send_message
# from src.ingestion.alerts.slack import send_message_to_user, get_all_users

from traced.core.auth.auth import get_current_db_user
from traced.core.sql_db.database import get_db

router = APIRouter()

# async def send_messages(user_email: str, message: str, assignment_name: str) -> None:
#     """Send notification messages to user via Slack and Gmail"""
#     # Normalize email to lowercase
#     user_email = user_email.lower()
#     # Send email notification (this will work regardless of Slack status)
#     try:
#         gmail_send_message(
#             to=user_email,
#             subject=f"New Feedback Assignment: {assignment_name}",
#             message_text=message
#         )
#     except Exception as e:
#         print(f"Failed to send email to {user_email}: {str(e)}")
#         # Continue execution even if email fails
#         pass
#     # Try to send Slack message if user exists in Slack
#     try:
#         slack_msg = f"🔔 *New Feedback Assignment*\n{message}"
#         users_dict = get_all_users()
#         if user_email in users_dict:
#             user_id = users_dict[user_email]
#             send_message_to_user(user_id, slack_msg)
#     except Exception as e:
#         print(f"Failed to send Slack message to {user_email}: {str(e)}")
#         # Continue execution even if Slack message fails
#         pass


@router.post("/assign_feedback")
async def assign_feedback(
    assignment: FeedbackAssignment,
    session=Depends(get_db("research_etl"))
) -> dict:
    """Assign rows to multiple users for feedback"""
    try:
        # Get experiment details for the first row
        exp_query = text("""
            SELECT e.name, e.id
            FROM experiments e
            JOIN `rows` r ON r.experiment_id = e.id
            WHERE r.id = :row_id
        """)
        result = await session.execute(exp_query, {"row_id": assignment.row_ids[0]})
        exp_data = result.mappings().one_or_none()
        if not exp_data:
            raise HTTPException(status_code=404, detail="Experiment not found")

        # First, create all assignments
        for row_id in assignment.row_ids:
            for user_email in assignment.user_emails:
                new_assignment = text("""
                    INSERT INTO `feedback_assignments`
                    (user_email, row_id, assignment_type, status, due_date)
                    VALUES (:user_email, :row_id, :assignment_type, :status, :due_date)
                """)
                await session.execute(
                    new_assignment,
                    {
                        "user_email": user_email,
                        "row_id": row_id,
                        "assignment_type": assignment.assignment_type,
                        "status": 'pending',
                        "due_date": assignment.due_date
                    }
                )

        # Then send one notification per user
        due_date_str = assignment.due_date.strftime("%B %d, %Y") if assignment.due_date else "No due date"
        for user_email in assignment.user_emails:
            message = f"""You have been assigned {len(assignment.row_ids)} row{'s' if len(assignment.row_ids) > 1 else ''} to review for the experiment: {exp_data['name']}.\n
Due date: {due_date_str}

Please sign in with an admin account.

You can access your assignments at: https://research.apeiron.life/internal/inbox

Instructions will be available on the website"""
            # await send_messages(user_email, message, exp_data['name'])

        await session.commit()
        return {"message": "Feedback assignments created successfully"}
    except Exception as e:
        import traceback
        traceback.print_exc()
        await session.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/rows/{row_id}/feedback")
async def create_feedback(
    row_id: str,
    feedback: FeedbackSchemaCreate,
    db: AsyncSession = Depends(get_db("research_etl")),
    current_user: User = Depends(get_current_db_user)
):
    """Create feedback for a specific row."""
    try:
        # Verify row exists using backticks
        query = text("""
            SELECT id FROM `rows`
            WHERE id = :row_id
        """)
        result = await db.execute(query, {"row_id": row_id})
        row = result.scalar_one_or_none()

        if not row:
            raise HTTPException(status_code=404, detail="Row not found")

        user_id = str(current_user.id)
        feedback_id = str(uuid.uuid4())

        # Create feedback using explicit INSERT
        insert_query = text("""
            INSERT INTO `feedback`
            (id, row_id, feedback, feedback_type, user_id, created_at)
            VALUES
            (:id, :row_id, :feedback, :feedback_type, :user_id, NOW())
        """)

        await db.execute(
            insert_query,
            {
                "id": feedback_id,
                "row_id": row_id,
                "feedback": json.dumps(feedback.feedback),
                "feedback_type": feedback.feedback_type,
                "user_id": user_id
            }
        )

        # Retrieve assignment type from feedback_assignments
        assignment_query = text("""
            SELECT assignment_type FROM `feedback_assignments`
            WHERE row_id = :row_id AND user_email = :user_email
        """)
        assignment_result = await db.execute(assignment_query, {"row_id": row_id, "user_email": current_user.email})
        assignment_type = assignment_result.scalar_one_or_none()

        # If pool-based, delete other assignments
        if assignment_type == 'pool':
            delete_query = text("""
                DELETE FROM `feedback_assignments`
                WHERE row_id = :row_id
                AND user_email != :user_email
            """)
            await db.execute(delete_query, {"row_id": row_id, "user_email": current_user.email})

        # Update the status of the current assignment to 'completed'
        update_status_query = text("""
            UPDATE `feedback_assignments`
            SET status = 'completed'
            WHERE row_id = :row_id AND user_email = :user_email
        """)
        await db.execute(update_status_query, {"row_id": row_id, "user_email": current_user.email})

        await db.commit()

        return {"message": "Feedback created successfully", "id": feedback_id}
    except Exception as e:
        import traceback
        traceback.print_exc()
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/rows/{row_id}/feedback/{feedback_id}")
async def get_feedback(
    row_id: str,
    feedback_id: str,
    db: AsyncSession = Depends(get_db("research_etl")),
    current_user: User = Depends(get_current_db_user)
):
    """Get specific feedback for a row."""
    try:
        # Query to get feedback with user information
        query = text("""
            SELECT 
                f.id,
                f.row_id,
                f.feedback,
                f.feedback_type,
                f.user_id,
                f.created_at,
                f.updated_at
            FROM `feedback` f
            WHERE f.id = :feedback_id
            AND f.row_id = :row_id
        """)

        result = await db.execute(query, {
            "feedback_id": feedback_id,
            "row_id": row_id
        })
        feedback = result.mappings().one_or_none()

        if not feedback:
            raise HTTPException(status_code=404, detail="Feedback not found")

        # Convert feedback data from JSON string to dict
        feedback_dict = dict(feedback)
        if feedback_dict.get('feedback'):
            feedback_dict['feedback'] = json.loads(feedback_dict['feedback'])

        # Convert datetime objects to ISO format strings
        if feedback_dict.get('created_at'):
            feedback_dict['created_at'] = feedback_dict['created_at'].isoformat()
        if feedback_dict.get('updated_at'):
            feedback_dict['updated_at'] = feedback_dict['updated_at'].isoformat()

        return feedback_dict

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/rows/{row_id}/feedback/{feedback_id}")
async def update_feedback(
    row_id: str,
    feedback_id: str,
    feedback: FeedbackSchemaCreate,
    db: AsyncSession = Depends(get_db("research_etl")),
    current_user: User = Depends(get_current_db_user)
):
    """Update existing feedback for a specific row."""
    try:
        # Verify feedback exists and belongs to user
        query = text("""
            SELECT id FROM `feedback`
            WHERE id = :feedback_id
            AND row_id = :row_id
            AND user_id = :user_id
        """)
        result = await db.execute(query, {
            "feedback_id": feedback_id,
            "row_id": row_id,
            "user_id": str(current_user.id)
        })
        existing_feedback = result.scalar_one_or_none()

        if not existing_feedback:
            raise HTTPException(
                status_code=404,
                detail="Feedback not found or you don't have permission to update it"
            )

        # Update feedback
        update_query = text("""
            UPDATE `feedback`
            SET
                feedback = :feedback,
                feedback_type = :feedback_type,
                updated_at = NOW()
            WHERE id = :feedback_id
        """)

        await db.execute(
            update_query,
            {
                "feedback_id": feedback_id,
                "feedback": json.dumps(feedback.feedback),
                "feedback_type": feedback.feedback_type
            }
        )

        await db.commit()

        return {"message": "Feedback updated successfully"}
    except Exception as e:
        import traceback
        traceback.print_exc()
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/experiments/{experiment_id}/feedback-template")
async def create_or_update_feedback_template(
    experiment_id: str,
    template: FeedbackTemplateCreate,
    db: AsyncSession = Depends(get_db("research_etl")),
):
    """Create or update feedback template for an experiment."""
    try:
        # Check if experiment exists
        query = text("""
            SELECT id FROM experiments
            WHERE id = :experiment_id
        """)
        result = await db.execute(query, {"experiment_id": experiment_id})
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Experiment not found")

        # Check if template exists
        template_query = text("""
            SELECT id FROM feedback_templates
            WHERE experiment_id = :experiment_id
        """)
        result = await db.execute(template_query, {"experiment_id": experiment_id})
        existing_template = result.scalar_one_or_none()

        if existing_template:
            # Update existing template
            update_query = text("""
                UPDATE feedback_templates
                SET fields = :fields,
                    display_columns = :display_columns,
                    description = :description,
                    walkthrough = :walkthrough,
                    updated_at = NOW()
                WHERE experiment_id = :experiment_id
            """)
            await db.execute(
                update_query,
                {
                    "experiment_id": experiment_id,
                    "fields": json.dumps(template.fields),
                    "display_columns": json.dumps(template.display_columns),
                    "description": template.description,
                    "walkthrough": json.dumps(template.walkthrough) if template.walkthrough else None
                }
            )
        else:
            # Create new template
            template_id = str(uuid.uuid4())
            insert_query = text("""
                INSERT INTO feedback_templates
                (id, experiment_id, fields, display_columns, description, walkthrough, created_at, updated_at)
                VALUES
                (:id, :experiment_id, :fields, :display_columns, :description, :walkthrough, NOW(), NOW())
            """)
            await db.execute(
                insert_query,
                {
                    "id": template_id,
                    "experiment_id": experiment_id,
                    "fields": json.dumps(template.fields),
                    "display_columns": json.dumps(template.display_columns),
                    "description": template.description,
                    "walkthrough": json.dumps(template.walkthrough) if template.walkthrough else None
                }
            )

        await db.commit()
        return {"message": "Feedback template saved successfully"}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/experiments/{experiment_id}/feedback-template")
async def get_feedback_template(
    experiment_id: str,
    db: AsyncSession = Depends(get_db("research_etl")),
):
    """Get feedback template for an experiment."""
    try:
        query = text("""
            SELECT id, experiment_id, fields, display_columns,
                   description, walkthrough, created_at, updated_at
            FROM feedback_templates
            WHERE experiment_id = :experiment_id
        """)
        result = await db.execute(query, {"experiment_name": experiment_id})
        template = result.mappings().one_or_none()

        if not template:
            return None

        return {
            "id": template["id"],
            "experiment_id": template["experiment_id"],
            "fields": json.loads(template["fields"]),
            "description": template["description"],
            "walkthrough": json.loads(template["walkthrough"]) if template["walkthrough"] else None,
            "display_columns": json.loads(template["display_columns"]),
            "created_at": template["created_at"],
            "updated_at": template["updated_at"]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/user_feedback_assignments")
async def get_assignments(
    current_user: User = Depends(get_current_db_user),
    session=Depends(get_db("research_etl"))
) -> List[dict]:
    try:
        user_email = current_user.email

        # Add join with Row to get experiment_id and check if any feedback exists
        stmt = select(feedback_assignments).join(
            Row,
            feedback_assignments.c.row_id == Row.id
        ).outerjoin(  # Add join with FeedbackModel to check for existing feedback
            FeedbackModel,
            feedback_assignments.c.row_id == FeedbackModel.row_id
        ).where(
            and_(
                feedback_assignments.c.user_email == user_email,
                feedback_assignments.c.status == 'pending',
                # For pool assignments, ensure no feedback exists
                or_(
                    feedback_assignments.c.assignment_type != 'pool',
                    FeedbackModel.id.is_(None)
                )
            )
        )
        result = await session.execute(stmt)
        assignments = result.fetchall()

        # Group by experiment and count rows
        experiment_counts = {}
        for assignment in assignments:
            row = await session.get(Row, assignment.row_id)
            if not row:
                continue

            exp_id = row.experiment_id
            if exp_id not in experiment_counts:
                experiment_counts[exp_id] = {
                    'count': 0,
                    'due_date': assignment.due_date
                }
            experiment_counts[exp_id]['count'] += 1

        response = []
        for exp_id, data in experiment_counts.items():
            # Get experiment details
            experiment = await session.get(Experiment, exp_id)
            if not experiment:
                continue

            # Get template with safe handling
            template = await session.execute(
                select(FeedbackTemplate)
                .where(FeedbackTemplate.experiment_id == exp_id)
            )
            template = template.scalar_one_or_none()

            experiment_data = {
                "experimentId": exp_id,
                "experimentName": experiment.name if experiment else "Unknown",
                "rowCount": data['count'],
                "template": {
                    "fields": template.fields,
                    "display_columns": template.display_columns,
                    "description": template.description,
                    "walkthrough": template.walkthrough,
                    "created_at": template.created_at,
                    "updated_at": template.updated_at
                } if template else None,
                "dueDate": data['due_date'],
            }
            response.append(experiment_data)

        return response

    except Exception as e:
        print(f"Error details: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/experiments/{experiment_id}/assigned-rows")
async def get_assigned_rows(
    experiment_id: str,
    current_user: User = Depends(get_current_db_user),
    session=Depends(get_db("research_etl"))
) -> List[dict]:
    try:
        # First get the row IDs that match both the experiment and the user's assignments
        assignments_query = (
            select(feedback_assignments.c.row_id)
            .join(Row, feedback_assignments.c.row_id == Row.id)
            .where(
                and_(
                    feedback_assignments.c.user_email == current_user.email,
                    feedback_assignments.c.status != 'completed',  # Exclude completed assignments
                    Row.experiment_id == experiment_id
                )
            )
        )
        result = await session.execute(assignments_query)
        row_ids = [row[0] for row in result.fetchall()]

        if not row_ids:
            return []

        # Get full row data
        rows_query = (
            select(Row)
            .options(
                selectinload(Row.spans),
                selectinload(Row.feedbacks)
            )
            .filter(Row.id.in_(row_ids))
        )
        rows_result = await session.execute(rows_query)
        rows = rows_result.scalars().unique().all()

        return [
            {
                "id": row.id,
                "input_data": row.input_data,
                "output_data": row.output_data,
                "tags": row.tags if row.tags else [],
                "spans": build_span_tree(row.spans),
                "feedback_count": len(row.feedbacks) if row.feedbacks else 0,
                "created_at": row.created_at
            }
            for row in rows
        ]

    except Exception as e:
        print(f"Error details: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))