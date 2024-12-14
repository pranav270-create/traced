import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ExternalLink, FileText } from 'lucide-react';
import { apiService } from '@/api/axios';
import { Assignment } from '@/types/eval';
// import annotationGuidePdf from '@/components/assets/annotationGuide.pdf?url';
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog"
import { useToast } from '@/hooks/use-toast';
import { Checkbox } from "@/components/ui/checkbox" // Add this import


export const InboxView: React.FC = () => {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAcknowledged, setIsAcknowledged] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    fetchAssignments();
  }, []);

  const fetchAssignments = async () => {
    try {
      const response = await apiService.get<Assignment[]>('/user_feedback_assignments');
      setAssignments(response);
    } catch (error) {
      console.error('Failed to fetch assignments:', error);
      toast({
        title: "Error",
        description: "Failed to fetch assignments. Please try again later.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleStartLabeling = (assignment: Assignment) => {
    setSelectedAssignment(assignment);
    setIsModalOpen(true);
  };

  const handleAcknowledge = async () => {
    if (selectedAssignment) {
      try {
        toast({
          title: "Loading",
          description: "Please wait while we fetch the data",
          variant: "default",
        });
        const response = await apiService.get<{ id: string }[]>(`/experiments/${selectedAssignment.experimentId}/assigned-rows`);
        const rows = response;
        
        const feedbackState = {
          experimentId: selectedAssignment.experimentId,
          experimentName: selectedAssignment.experimentName,
          rows,
          template: {
            columns: selectedAssignment.template.display_columns,
            feedbackTemplate: selectedAssignment.template
          },
          filters: {
            selectedRowIds: rows.map((row) => row.id),
          }
        };
        navigate("/feedback", { state: feedbackState });
      } catch (error) {
        console.error('Failed to fetch rows:', error);
      } finally {
        setIsModalOpen(false);
      }
    }
  };

  if (loading) {
    return (
      <div className="p-12">
        <CardHeader>
          <CardTitle>My Tasks</CardTitle>
          <CardDescription>Your assigned labeling tasks</CardDescription>
        </CardHeader>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <Skeleton className="h-6 w-48 mb-2" />
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-5 w-20" />
                      <Skeleton className="h-5 w-32" />
                    </div>
                  </div>
                  <Skeleton className="h-10 w-32" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-12">
      <CardHeader>
        <CardTitle>My Tasks</CardTitle>
        <CardDescription>Your assigned labeling tasks</CardDescription>
      </CardHeader>

      <ScrollArea className="h-[calc(100vh-200px)]">
        <div className="space-y-4">
          {assignments.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-muted-foreground text-center">
                  No tasks assigned to you at the moment.
                </p>
              </CardContent>
            </Card>
          ) : (
            assignments.map((assignment) => (
              <Card key={assignment.experimentId}>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">{assignment.experimentName}</h3>
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant="secondary">
                          {assignment.rowCount} rows
                        </Badge>
                        {assignment.dueDate && (
                          <Badge variant="outline">
                            Due: {new Date(assignment.dueDate).toLocaleDateString()}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Button 
                      onClick={() => handleStartLabeling(assignment)}
                      className="flex items-center gap-2"
                    >
                      Start Labeling
                      <ExternalLink size={16} />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </ScrollArea>

      {selectedAssignment && (
        <Dialog open={isModalOpen} onOpenChange={(open) => setIsModalOpen(open)}>
          <DialogContent className="max-w-4xl bg-white max-h-[99vh] flex flex-col">
            <div className="flex-1 overflow-y-auto">
              <div 
                className="mt-0 prose prose-slate prose-ul:list-disc prose-li:marker:text-slate-500"
                dangerouslySetInnerHTML={{ __html: selectedAssignment.template.description }}
              />
              <a 
                href="https://docs.google.com/document/d/1AJpDZVMsBXlGWg2jWqenUUou6QVpiQD_iyAFj8rpNgA/edit?tab=t.0"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-blue-600 hover:text-blue-800 mt-2"
              >
                <FileText size={16} />
                View full documentation in Google Docs
              </a>
              {/* <div className="mt-4 w-full" style={{ height: 'calc(90vh - 100px)' }}>
                <iframe
                  src={annotationGuidePdf}
                  className="w-full h-full border-none"
                  title="Assignment Documentation"
                />
              </div> */}
            </div>
            
            <div className="mt-6 space-y-4 flex-shrink-0 border-t pt-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="acknowledge"
                  checked={isAcknowledged}
                  onCheckedChange={(checked) => setIsAcknowledged(checked as boolean)}
                />
                <label
                  htmlFor="acknowledge"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  I have read and understood the assignment description
                </label>
              </div>
              <Button 
                onClick={handleAcknowledge} 
                className="w-full"
                disabled={!isAcknowledged}
              >
                Acknowledge and Continue
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};