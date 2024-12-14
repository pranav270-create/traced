
  // Add this helper function at the component level
  export const getNestedValue = (obj: any, path: string): string => {
    if (!obj || !path) return '';
    
    const pathParts = path.split('.');
    let current = obj;
  
    for (const part of pathParts) {
      if (current === null || current === undefined) return '';
  
      // Handle array access with index: matches patterns like "spans[0]" or "children[2]"
      const arrayMatch = part.match(/^(.+)\[(\d+)\]$/);
      if (arrayMatch) {
        const [, arrayName, indexStr] = arrayMatch;
        const index = parseInt(indexStr, 10);
        
        // First access the array
        current = current[arrayName];
        
        // Then access the index if array exists
        if (Array.isArray(current) && index < current.length) {
          current = current[index];
        } else {
          return '';
        }
      } else {
        // Regular object property access
        current = current[part];
      }
    }
  
    // Handle different types of values
    if (current === null || current === undefined) {
      return '';
    } else if (typeof current === 'object' || Array.isArray(current)) {
      try {
        return JSON.stringify(current);
      } catch {
        return '';
      }
    }
  
    return String(current);
  };


  export const setNestedValue = (obj: any, path: string, value: any): void => {
    const parts = path.split('.');
    let current = obj;
    
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current)) {
        current[part] = {};
      }
      current = current[part];
    }
    
    current[parts[parts.length - 1]] = value;
  };


  // Function to get value from nested object using path
  export const getValueFromPath = (obj: any, path: string) => {
    try {
      return path.split('.').reduce((acc, part) => {
        if (part.includes('[')) {
          // Handle array access
          const [arrayPart, indexPart] = part.split('[');
          const index = parseInt(indexPart.replace(']', ''), 10);
          return acc[arrayPart][index];
        }
        return acc[part];
      }, obj);
    } catch {
      return '';
    }
  };