const axios = require('axios');

// Telegram notification service for backend
class TelegramService {
    constructor() {
        this.axios = axios;
    }

    async sendTelegramNotification(message, settings) {
        if (!settings?.enabled || !settings.botToken || !settings.chatId) {
            return { success: false, error: 'Telegram not configured or disabled' };
        }

        try {
            const telegramApiUrl = `https://api.telegram.org/bot${settings.botToken}/sendMessage`;
            const response = await this.axios.post(telegramApiUrl, {
                chat_id: settings.chatId,
                text: message,
                parse_mode: 'HTML'
            });
            
            return { success: true, data: response.data };
        } catch (error) {
            console.error('Failed to send Telegram notification:', error.response?.data || error.message);
            return { success: false, error: error.response?.data || error.message };
        }
    }

    async testTelegramConnection(settings) {
        const testMessage = "🧪 <b>Test Message</b>\n\nThis is a test message from your MikroTik Billing Manager panel.\n\nIf you received this message, your Telegram integration is working correctly!";
        return await this.sendTelegramNotification(testMessage, settings);
    }
}

module.exports = TelegramService;