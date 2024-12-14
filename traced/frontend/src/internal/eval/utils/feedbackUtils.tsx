// Utility file for feedback processing
import { Feedback } from '../../../types/eval.ts'

export const _getFeedbackValue = (
    row: any, 
    fieldKey: string, 
    userId: string | number, 
    feedbackType: string,
    grouping: 'none' | 'averageByUser' | 'latestByUser' | 'averageByType' | 'averageByTypeByUser'
  ) => {
    const feedbacks = row.feedbacks || [];
    
    // Filter feedbacks matching the fieldKey, userId, feedbackType
    let matchingFeedbacks = feedbacks.filter((fb: Feedback) => {
      let matches = fb.feedback[fieldKey] !== undefined;
  
      switch (grouping) {
        case 'none':
          matches = matches && 
                   String(fb.user_id) === String(userId) && 
                   String(fb.feedback_type) === String(feedbackType);
          break;
        case 'averageByType':
          matches = matches && String(fb.feedback_type) === String(feedbackType);
          break;
        case 'averageByUser':
          matches = matches && String(fb.user_id) === String(userId);
          break;
        case 'latestByUser':
          matches = matches && String(fb.user_id) === String(userId);
          break;
        case 'averageByTypeByUser':
          matches = matches && 
                   String(fb.user_id) === String(userId) && 
                   String(fb.feedback_type) === String(feedbackType);
          break;
      }
  
      return matches;
    });
  
    if (matchingFeedbacks.length === 0) return null;
  
    // Process the matched feedbacks based on grouping type
    switch (grouping) {
      case 'none':
        return matchingFeedbacks.map((fb: Feedback) => fb.feedback[fieldKey]);
      
      case 'averageByType':
      case 'averageByUser':
      case 'averageByTypeByUser':
        const numericValues = matchingFeedbacks
          .map((fb: Feedback) => {
            const value = fb.feedback[fieldKey];
            if (typeof value === 'string') {
              const parsed = parseFloat(value);
              return isNaN(parsed) ? null : parsed;
            }
            return typeof value === 'number' ? value : null;
          })
          .filter((v: any): v is number => v !== null);
  
        if (numericValues.length === 0) return null;
        return numericValues.reduce((acc: any, val: any) => acc + val, 0) / numericValues.length;
      
      case 'latestByUser':
        // Sort by timestamp if available, otherwise take the last feedback
        return matchingFeedbacks[matchingFeedbacks.length - 1].feedback[fieldKey];
    }
  };

  export const getFeedbackValue = (
    row: any, 
    fieldKey: string, 
    userId: string | number, 
    feedbackType: string,
    grouping: 'none' | 'averageByUser' | 'latestByUser' | 'averageByType' | 'averageByTypeByUser'
  ) => {
    const feedbacks = row.feedbacks || [];
    
    // Filter feedbacks matching the fieldKey, userId, feedbackType
    let matchingFeedbacks = feedbacks.filter((fb: Feedback) => {
      // First check if the field exists in feedback
      if (fb.feedback[fieldKey] === undefined) return false;
  
      // Normalize IDs and types for comparison
      const matchesUser = String(fb.user_id) === String(userId);
      const matchesType = String(fb.feedback_type) === String(feedbackType);
  
      switch (grouping) {
        case 'none':
          return matchesUser && matchesType;
        case 'averageByType':
          return matchesType;
        case 'averageByUser':
          return matchesUser;
        case 'latestByUser':
          return matchesUser;
        case 'averageByTypeByUser':
          return matchesUser && matchesType;
        default:
          return false;
      }
    });
  
    if (matchingFeedbacks.length === 0) return null;
  
    // For latestByUser, sort by timestamp first
    if (grouping === 'latestByUser') {
      matchingFeedbacks.sort((a: Feedback, b: Feedback) => {
        const timeA = new Date(a.timestamp).getTime();
        const timeB = new Date(b.timestamp).getTime();
        return timeB - timeA; // Sort in descending order (newest first)
      });
      return matchingFeedbacks[0].feedback[fieldKey];
    }
  
    // For averaging cases, handle different value types
    if (['averageByType', 'averageByUser', 'averageByTypeByUser'].includes(grouping)) {
      const values = matchingFeedbacks.map((fb: Feedback) => fb.feedback[fieldKey]);
      
      // Check if all values are numeric or binary
      const isNumeric = values.every(v => 
        typeof v === 'number' || 
        (typeof v === 'string' && !isNaN(parseFloat(v)))
      );
  
      if (isNumeric) {
        const numericValues = values.map(v => 
          typeof v === 'number' ? v : parseFloat(v)
        );
        return numericValues.reduce((acc, val) => acc + val, 0) / numericValues.length;
      }
  
      // For non-numeric values (e.g., text), return the most recent one
      matchingFeedbacks.sort((a: Feedback, b: Feedback) => {
        const timeA = new Date(a.timestamp).getTime();
        const timeB = new Date(b.timestamp).getTime();
        return timeB - timeA;
      });
      return matchingFeedbacks[0].feedback[fieldKey];
    }
  
    // For 'none' grouping, return array of values
    return matchingFeedbacks.map((fb: Feedback) => fb.feedback[fieldKey]);
  };