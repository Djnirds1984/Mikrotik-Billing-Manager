


import { GoogleGenAI, Type } from "@google/genai";
import type { AIFixResponse, ChatMessage, HotspotSetupParams } from '../types.ts';

let ai: GoogleGenAI | null = null;

export const initializeAiClient = (apiKey?: string) => {
    if (apiKey && apiKey !== "YOUR_GEMINI_API_KEY_HERE") {
        try {
            // FIX: Cast window to 'any' to access the 'process' property injected by env.js.
            if ((window as any).process?.env) {
                (window as any).process.env.API_KEY = apiKey;
            }
            ai = new GoogleGenAI({ apiKey });
        } catch (e) {
            console.error("Failed to initialize GoogleGenAI client:", e);
            ai = null;
        }
    } else {
        ai = null;
    }
};

// Initial call on page load using the key from env.js
initializeAiClient(process.env.API_KEY);


const SCRIPT_SYSTEM_INSTRUCTION = `You are an expert MikroTik network engineer specializing in RouterOS.
Your sole purpose is to generate RouterOS terminal command scripts based on user requests.
Follow these rules strictly:
1. ONLY output the script. Do not provide any conversational text, explanations, greetings, or apologies.
2. The script must be syntactically correct and ready to be pasted directly into a MikroTik terminal.
3. Use best practices for security and efficiency. For example, add comments to complex rules where appropriate.
4. If the user's request is ambiguous, make a reasonable assumption based on common network configurations.
5. If the request is impossible or nonsensical, output a single comment line starting with '#' explaining why. For example: '# Error: Cannot assign a public IP to a local bridge.'`;

const FIXER_SYSTEM_INSTRUCTION = `You are an expert full-stack developer with deep knowledge of Node.js, Express.js, and the MikroTik REST API.
Your task is to act as an automated debugger and code fixer.
You will be given the full source code of a Node.js backend file, the error message the user sees in the frontend, and the name of the MikroTik router they are connected to.
Your goal is to identify the bug in the provided code that is causing the error, fix it, and provide the complete, corrected file content.

RULES:
1. Analyze the error message in the context of the provided code. The error is likely related to how the code communicates with the MikroTik router via its REST API.
2. Common bugs include: incorrect API endpoints (e.g., /system/routerboard on a CHR), mishandling of MikroTik's 'kebab-case' property names, race conditions from using 'Promise.all', or incorrect data mapping that causes frontend display issues.
3. Provide a brief, clear explanation of the bug you found and how your fix resolves it. Keep it concise (2-3 sentences).
4. Provide the *entire*, complete, corrected code for the file. Do not use placeholders or omit sections. The user will replace their entire file with your output.
5. Your final output MUST be a JSON object matching the provided schema. Do not add any conversational text or markdown formatting outside of the JSON object.`;

const HELP_SYSTEM_INSTRUCTION = `You are a helpful and friendly AI assistant for the 'Mikrotik Billling Management by AJC' web panel.
Your goal is to help users understand and troubleshoot issues with the panel and their MikroTik router.
You will be given the user's conversation history and their current question, along with context about which page they are on and which router they have selected.

RULES:
1. Be concise and helpful.
2. If the user's question is about an error, use the provided context (page, router name) to offer specific troubleshooting steps.
3. If the user asks what a page does, explain its purpose clearly. For example, for the 'PPPoE Profiles' page, explain that it's used to create speed limit and IP address plans for PPPoE users.
4. If you don't know the answer, say so. Do not make up information.
5. Keep your answers focused on the web panel and MikroTik routers.`;

const REPORT_SYSTEM_INSTRUCTION = `You are a senior network engineer and full-stack developer.
Your task is to analyze a raw system state report and provide a diagnostic summary.
The report contains the user's current view, selected router, the panel's backend code, and the ZeroTier status on the host.
Your analysis should be at the TOP of the report you generate.

RULES:
1. Start your analysis with a "Diagnosis Summary" section.
2. Based on all the provided context, identify the most likely cause of a potential problem. For example, if the user is on the Dashboard and the backend code has a bug in the '/api/system-info' endpoint, point that out.
3. If the ZeroTier status shows an error, explain what it means.
4. If no obvious errors are present, state that the system appears to be in a normal state but provide general troubleshooting steps related to the user's current view.
5. Keep the summary concise and actionable.
6. Your output will be ONLY the analysis text. The user will prepend it to the raw data file.`;

const checkAiInitialized = () => {
    if (!ai) {
        throw new Error("Gemini API client not initialized. Please set your API key in System Settings.");
    }
    return ai;
};


export const generateMikroTikScript = async (userPrompt: string): Promise<string> => {
  try {
    const aiClient = checkAiInitialized();
    const response = await aiClient.models.generateContent({
      model: "gemini-2.5-flash",
      contents: userPrompt,
      config: {
        systemInstruction: SCRIPT_SYSTEM_INSTRUCTION,
        temperature: 0.2,
        topP: 0.9,
        topK: 40,
      },
    });

    const script = response.text.trim();
    return script.replace(/^```(routeros|bash|sh)?\s*|```$/g, '').trim();
  } catch (error) {
    console.error("Error generating script from Gemini API:", error);
    if (error instanceof Error) {
        if (error.message.includes('API key not valid')) {
            return `# Error: Invalid Gemini API Key. Please check the key in System Settings.`;
        }
        return `# Error: ${error.message}`;
    }
    return `# Error: Failed to communicate with the AI service.`;
  }
};

export const generateMultiWanScript = async (wanInterfaces: string[], lanInterface: string, type: 'pcc' | 'pbr'): Promise<string> => {
    const typeDescription = type === 'pcc'
        ? "PCC (Per Connection Classifier) for load balancing to merge the speed of the WAN links."
        : "PBR (Policy Based Routing) for a failover setup. The first WAN interface should be the primary, and the rest are backups.";

    const prompt = `Generate a complete MikroTik RouterOS script for a multi-WAN setup with the following specifications:
- WAN Interfaces: ${wanInterfaces.join(', ')}
- LAN Interface: ${lanInterface}
- Configuration Type: ${typeDescription}

The script should include all necessary mangle rules for routing marks, NAT rules for masquerading, and routing table entries. Assume the WAN interfaces receive their IPs via DHCP. Add comments to explain each major step of the script.`;

    return generateMikroTikScript(prompt);
};

export const generateHotspotSetupScript = async (params: HotspotSetupParams): Promise<string> => {
    const prompt = `
        Generate a complete MikroTik RouterOS script to set up a new Hotspot server using the WinBox "Hotspot Setup" wizard as a reference.

        The script must perform the following actions based on these user-provided parameters:
        - Hotspot Interface: ${params.hotspotInterface}
        - Local Address of Network: ${params.localAddress} (This IP should be assigned to the hotspot interface)
        - Address Pool of Network: ${params.addressPool} (This is the range for the DHCP server)
        - Select Certificate: ${params.sslCertificate} (If not 'none', use this certificate for the HTTPS login)
        - IP Address of SMTP Server: 0.0.0.0
        - DNS Servers: ${params.dnsServers}
        - DNS Name: ${params.dnsName}
        - Create a user for the hotspot with these credentials:
          - User: ${params.hotspotUser}
          - Password: ${params.hotspotPass}

        The script MUST be complete and include all necessary steps:
        1.  Create the IP pool.
        2.  Create the hotspot profile. Set the dns-name and http-cookie-lifetime.
        3.  Create the hotspot server on the correct interface, linking the profile and pool.
        4.  Add the IP address to the hotspot interface.
        5.  Create the DHCP server configuration for the hotspot network.
        6.  Add a NAT rule to masquerade traffic from the hotspot network's source address range.
        7.  Create the initial hotspot user.

        Add comments to explain each major step.
    `;

    return generateMikroTikScript(prompt);
};


export const fixBackendCode = async (backendCode: string, errorMessage: string, routerName: string): Promise<AIFixResponse> => {
    try {
        const aiClient = checkAiInitialized();
        const userPrompt = `The user is seeing the error "${errorMessage}" when connected to a router named "${routerName}". Please analyze and fix the following backend code:\n\n\`\`\`javascript\n${backendCode}\n\`\`\``;

        const response = await aiClient.models.generateContent({
            model: "gemini-2.5-flash",
            contents: userPrompt,
            config: {
                systemInstruction: FIXER_SYSTEM_INSTRUCTION,
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        explanation: {
                            type: Type.STRING,
                            description: "A brief, clear explanation of the bug and the fix.",
                        },
                        fixedCode: {
                            type: Type.STRING,
                            description: "The complete, corrected source code for the entire file.",
                        },
                    },
                    required: ["explanation", "fixedCode"],
                },
            },
        });

        const jsonString = response.text.trim();
        return JSON.parse(jsonString) as AIFixResponse;
    } catch (error) {
        console.error("Error generating code fix from Gemini API:", error);
        if (error instanceof Error) {
            if (error.message.includes('API key not valid')) {
                throw new Error("Invalid Gemini API Key. Please check it in System Settings.");
            }
        }
        throw error;
    }
};

export const getAiHelp = async (context: string, history: ChatMessage[], question: string): Promise<string> => {
    try {
        const aiClient = checkAiInitialized();
        const contents = [
            ...history.map(msg => ({
                role: msg.role === 'model' ? 'model' : 'user',
                parts: [{ text: msg.content }]
            })),
            { role: 'user', parts: [{ text: `CONTEXT: ${context}\n\nQUESTION: ${question}` }] }
        ];

        const response = await aiClient.models.generateContent({
            model: "gemini-2.5-flash",
            // @ts-ignore
            contents: contents,
            config: {
                systemInstruction: HELP_SYSTEM_INSTRUCTION,
            }
        });

        return response.text.trim();
    } catch (error) {
        console.error("Error getting help from Gemini API:", error);
         if (error instanceof Error) {
            if (error.message.includes('API key not valid')) {
                throw new Error("Invalid Gemini API Key. Please check it in System Settings.");
            }
        }
        throw error;
    }
};

export const analyzeSystemState = async (context: { view: string; routerName: string; backendCode: string; ztStatus: string; }): Promise<string> => {
    try {
        const aiClient = checkAiInitialized();
        const prompt = `Here is the current system state:\n- Current Page: ${context.view}\n- Router: ${context.routerName}\n- ZeroTier Status: ${context.ztStatus}\n\nAnalyze this information along with the backend code and provide a diagnostic summary.\n\n\`\`\`javascript\n${context.backendCode}\n\`\`\``;
        const response = await aiClient.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                systemInstruction: REPORT_SYSTEM_INSTRUCTION,
            }
        });
        return response.text.trim();
    } catch (error) {
        console.error("Error analyzing system state:", error);
        if (error instanceof Error) {
             if (error.message.includes('API key not valid')) {
                return `DIAGNOSIS FAILED: Invalid Gemini API Key.`;
            }
            return `DIAGNOSIS FAILED: ${error.message}`;
        }
        return "DIAGNOSIS FAILED: Could not communicate with the AI service.";
    }
};
