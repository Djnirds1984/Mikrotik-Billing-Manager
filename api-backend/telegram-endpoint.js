// Telegram API Endpoints
app.post('/api/telegram/test', async (req, res) => {
    try {
        const { botToken, chatId, message } = req.body;
        
        if (!botToken || !chatId || !message) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing required parameters: botToken, chatId, and message are required.' 
            });
        }

        // Send message via Telegram Bot API
        const telegramApiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
        const response = await axios.post(telegramApiUrl, {
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML'
        });

        if (response.data.ok) {
            res.json({ success: true, message: 'Message sent successfully!' });
        } else {
            res.status(400).json({ 
                success: false, 
                error: 'Telegram API returned an error: ' + response.data.description 
            });
        }
    } catch (error) {
        console.error('Telegram API error:', error.response?.data || error.message);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to send Telegram message: ' + (error.response?.data?.description || error.message) 
        });
    }
});