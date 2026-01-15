import { useState, useEffect, useCallback } from 'react';
import type { RouterConfig, RouterConfigWithId } from '../types.ts';
import { dbApi } from '../services/databaseService.ts';

export const useRouters = () => {
    const [routers, setRouters] = useState<RouterConfigWithId[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchRouters = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await dbApi.get<RouterConfigWithId[]>('/routers');
            setRouters(data);
        } catch (err) {
            setError((err as Error).message);
            console.error("Failed to fetch routers from DB", err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchRouters();
    }, [fetchRouters]);

    const addRouter = async (routerConfig: RouterConfig) => {
        try {
            const newRouter: RouterConfigWithId = {
                ...routerConfig,
                id: `router_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            };
            await dbApi.post('/routers', newRouter);
            await fetchRouters();
        } catch (err) {
            console.error("Failed to add router:", err);
            // Optionally, handle the error in the UI
        }
    };

    const updateRouter = async (updatedRouter: RouterConfigWithId) => {
        try {
            // The password field is not always sent from the form if unchanged.
            // We need to merge with the existing data to avoid accidentally wiping it.
            const existingRouter = routers.find(r => r.id === updatedRouter.id);
            const dataToSend = { ...existingRouter, ...updatedRouter };
            
            await dbApi.patch(`/routers/${updatedRouter.id}`, dataToSend);
            await fetchRouters();
        } catch (err) {
            console.error("Failed to update router:", err);
        }
    };

    const deleteRouter = async (routerId: string) => {
        try {
            await dbApi.delete(`/routers/${routerId}`);
            await fetchRouters();
        } catch (err) {
            console.error("Failed to delete router:", err);
        }
    };

    return { routers, addRouter, updateRouter, deleteRouter, isLoading, error };
};