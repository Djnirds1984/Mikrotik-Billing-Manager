// Debug script to check browser storage and state
(function() {
    console.log('=== BROWSER DEBUG INFO ===');
    
    // Check localStorage
    console.log('localStorage items:');
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const value = localStorage.getItem(key);
        console.log(`  ${key}: ${value}`);
    }
    
    // Check sessionStorage
    console.log('sessionStorage items:');
    for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        const value = sessionStorage.getItem(key);
        console.log(`  ${key}: ${value}`);
    }
    
    // Check if there are any global variables that might hold router state
    console.log('Window objects that might contain router data:');
    const possibleKeys = ['router', 'selectedRouter', 'selectedRouterId', 'routers'];
    possibleKeys.forEach(key => {
        if (window[key]) {
            console.log(`  window.${key}:`, window[key]);
        }
    });
    
    // Check React DevTools if available
    if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
        console.log('React DevTools detected - check React component tree for router state');
    }
    
    console.log('=== END DEBUG INFO ===');
})();