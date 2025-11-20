// Utility to clear all router-related caches and state
export const clearRouterCache = () => {
  // Clear browser storage
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem('selectedRouterId');
    sessionStorage.removeItem('selectedRouter');
    
    // Clear any potential localStorage items (though we don't use them for router state)
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.includes('router')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
  }
  
  console.log('Router cache cleared');
};

// Utility to validate router ID exists in current routers list
export const validateRouterSelection = (selectedRouterId: string | null, routers: any[]) => {
  if (!selectedRouterId) return null;
  const exists = routers.find(r => r.id === selectedRouterId);
  return exists ? selectedRouterId : null;
};