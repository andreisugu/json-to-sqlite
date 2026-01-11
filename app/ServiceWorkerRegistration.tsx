'use client';

import { useEffect } from 'react';

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    // Check if service workers are supported
    if ('serviceWorker' in navigator) {
      // Register the service worker
      navigator.serviceWorker
        .register('/json-to-sqlite/sw.js', {
          scope: '/json-to-sqlite/',
        })
        .then((registration) => {
          console.log('[App] Service Worker registered successfully:', registration.scope);
          
          // Check for updates periodically
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            console.log('[App] New Service Worker found, installing...');
            
            if (newWorker) {
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  // New service worker available, could show update notification here
                  console.log('[App] New Service Worker installed, ready to activate');
                }
              });
            }
          });
        })
        .catch((error) => {
          console.error('[App] Service Worker registration failed:', error);
        });

      // Listen for messages from the service worker
      navigator.serviceWorker.addEventListener('message', (event) => {
        console.log('[App] Message from Service Worker:', event.data);
      });

      // Log when the controlling service worker changes
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        console.log('[App] Service Worker controller changed');
      });
    } else {
      console.warn('[App] Service Workers are not supported in this browser');
    }
  }, []);

  return null; // This component doesn't render anything
}
