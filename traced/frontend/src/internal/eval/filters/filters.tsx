// First, let's define our filter functions properly
export const stringFilterFn = (row: any, columnId: string, filterValue: any): boolean => {
    const value = row.getValue(columnId);
    if (!value) return false;
    
    const { operator, value: searchValue } = filterValue;
    const stringValue = String(value).toLowerCase();
    const searchString = String(searchValue).toLowerCase();
  
    switch (operator) {
      case 'equals':
        return stringValue === searchString;
      case 'contains':
        return stringValue.includes(searchString);
      default:
        return false;
    }
  };
  
  export const numberFilterFn = (row: any, columnId: string, filterValue: any): boolean => {
    const value = row.getValue(columnId);
    if (!value) return false;
  
    const { operator, value: compareValue } = filterValue;
    const numValue = Number(value);
    const compareNum = Number(compareValue);
  
    if (isNaN(numValue) || isNaN(compareNum)) return false;
  
    switch (operator) {
      case '=': return numValue === compareNum;
      case '>': return numValue > compareNum;
      case '<': return numValue < compareNum;
      case '>=': return numValue >= compareNum;
      case '<=': return numValue <= compareNum;
      default: return false;
    }
  };
  
  export const dateFilterFn = (row: any, columnId: string, filterValue: any): boolean => {
    const value = row.getValue(columnId);
    if (!value) return false;
  
    const { operator, value: compareValue } = filterValue;
    // Convert compareValue to ISO format
    const compareDateISO = new Date(compareValue.replace(' ', 'T'));
  
    let dateValue = value instanceof Date ? value : new Date(value);
  
    if (isNaN(dateValue.getTime()) || isNaN(compareDateISO.getTime())) {
      console.log('Invalid date detected');
      return false;
    }
  
    // Subtract 6 hours from the row date for EST adjustment
    dateValue = new Date(dateValue.getTime() - 6 * 60 * 60 * 1000);
  
    switch (operator) {
      case 'on': return dateValue.getTime() === compareDateISO.getTime();
      case 'before': return dateValue < compareDateISO;
      case 'after': return dateValue > compareDateISO;
      default: return false;
    }
  };