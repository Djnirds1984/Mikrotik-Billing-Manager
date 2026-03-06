import { dbApi } from './databaseService.ts';

export interface ApplicationFormData {
  userData: {
    name: string;
    phone?: string;
    email?: string;
  };
  customerData?: {
    fullName?: string;
    accountNumber?: string;
    contactNumber?: string;
    email?: string;
    address?: string;
    gps?: string;
  };
  planData?: {
    name?: string;
    price?: number;
    currency?: string;
    speedLimit?: string;
    planType?: string;
  };
  companySettings?: {
    companyName?: string;
    address?: string;
    contactNumber?: string;
    email?: string;
    logoBase64?: string;
  };
  source: 'pppoe' | 'dhcp';
}

export const generateApplicationForm = async (formData: ApplicationFormData): Promise<{ id: string; pdfUrl: string; message: string }> => {
  try {
    const response = await fetch('/api/public/generate-application', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(formData),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to generate application form');
    }

    return await response.json();
  } catch (error) {
    console.error('Error generating application form:', error);
    throw error;
  }
};

export const getCompanySettings = async (): Promise<ApplicationFormData['companySettings']> => {
  try {
    const settings = await dbApi.get('/settings');
    return {
      companyName: settings.companyName,
      address: settings.address,
      contactNumber: settings.contactNumber,
      email: settings.email,
      logoBase64: settings.logoBase64,
    };
  } catch (error) {
    console.error('Error fetching company settings:', error);
    return {};
  }
};

export const deleteApplication = async (id: string): Promise<void> => {
  try {
    await dbApi.delete(`/applications/${id}`);
  } catch (error) {
    console.error('Error deleting application:', error);
    throw error;
  }
};