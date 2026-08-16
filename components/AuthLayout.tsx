import React from 'react';
import { MikroTikLogoIcon } from '../constants.tsx';

export const AuthLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    return (
        <div className="min-h-screen bg-[#0A0D18] flex flex-col justify-center items-center py-12 sm:px-6 lg:px-8">
            <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
                <MikroTikLogoIcon className="mx-auto h-16 w-auto text-[#00E5FF]" />
                <h1 className="mt-4 text-3xl font-extrabold text-white">
                    Mikrotik Billling Management by AJC
                </h1>
            </div>

            <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                <div className="bg-[#151A28] py-8 px-4 shadow-lg sm:rounded-xl sm:px-10 border border-[#1E2538]">
                    {children}
                </div>
            </div>
        </div>
    );
};