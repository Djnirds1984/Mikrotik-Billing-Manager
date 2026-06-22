import React, { useEffect } from 'react';

/**
 * HotspotLoginPage - Redirects to the standalone HTML captive portal.
 * The actual captive portal is a plain HTML file at /hotspot-login.html
 * which can be easily edited without touching React/TypeScript code.
 *
 * This component simply forwards all query parameters to the static file.
 */
export const HotspotLoginPage: React.FC = () => {
    useEffect(() => {
        // Forward all query params to the static HTML file
        window.location.replace('/hotspot-login.html' + window.location.search);
    }, []);

    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            fontFamily: 'sans-serif',
            color: '#64748b',
        }}>
            Redirecting to login page...
        </div>
    );
};
