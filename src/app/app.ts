import { App } from "@microsoft/teams.apps";
import { ChatPrompt } from "@microsoft/teams.ai";
import { LocalStorage } from "@microsoft/teams.common";
import { OpenAIChatModel } from "@microsoft/teams.openai";
import { MessageActivity, TokenCredentials } from '@microsoft/teams.api';
import { ManagedIdentityCredential } from '@azure/identity';
import * as fs from 'fs';
import * as path from 'path';
import config from "../config";
import { jiraConfig } from "../config/jira.config";
import JiraClient from 'jira-client';

console.log('Initializing JIRA client with config:', {
    host: jiraConfig.baseUrl,
    email: jiraConfig.email,
    project: jiraConfig.project,
    hasToken: !!jiraConfig.token
});

// Initialize JIRA client
const jira = new JiraClient({
    protocol: 'https',
    host: jiraConfig.baseUrl,
    username: jiraConfig.email,
    password: jiraConfig.token,
    apiVersion: '3',
    strictSSL: true,
    timeout: 5000
});

// Test JIRA connection
async function testJiraConnection() {
    try {
        console.log('Attempting JIRA connection with config:', {
            host: jiraConfig.baseUrl,
            email: jiraConfig.email,
            project: jiraConfig.project,
            hasToken: !!jiraConfig.token
        });
        
        const myself = await jira.getCurrentUser();
        console.log('JIRA Connection successful:', myself);
        return true;
    } catch (error) {
        console.error('JIRA Connection failed. Details:', {
            statusCode: error.statusCode,
            message: error.message,
            response: error.response?.data,
            error: JSON.stringify(error, null, 2)
        });
        return false;
    }
}

// Test connection on startup
testJiraConnection();

// Validate JIRA configuration
if (!jiraConfig.baseUrl || !jiraConfig.token || !jiraConfig.email || !jiraConfig.project) {
    console.error('Missing required JIRA configuration. Please check your .env.dev file.');
}

// Create storage for conversation history
const storage = new LocalStorage();

// Load instructions from file on initialization
function loadInstructions(): string {
  const instructionsFilePath = path.join(__dirname, "instructions.txt");
  return fs.readFileSync(instructionsFilePath, 'utf-8').trim();
}

// Load instructions once at startup
const instructions = loadInstructions();

const createTokenFactory = () => {
  return async (scope: string | string[], tenantId?: string): Promise<string> => {
    const managedIdentityCredential = new ManagedIdentityCredential({
        clientId: process.env.CLIENT_ID
      });
    const scopes = Array.isArray(scope) ? scope : [scope];
    const tokenResponse = await managedIdentityCredential.getToken(scopes, {
      tenantId: tenantId
    });
   
    return tokenResponse.token;
  };
};

// Configure authentication using TokenCredentials
const tokenCredentials: TokenCredentials = {
  clientId: process.env.CLIENT_ID || '',
  token: createTokenFactory()
};

const credentialOptions = config.MicrosoftAppType === "UserAssignedMsi" ? { ...tokenCredentials } : undefined;

// Create the app with storage
const app = new App({
  ...credentialOptions,
  storage
});

// Function to handle JIRA queries
async function handleJiraQuery(query: string): Promise<string> {
  try {
    // Test connection before proceeding
    const isConnected = await testJiraConnection();
    if (!isConnected) {
      return 'Unable to connect to JIRA. Please check your credentials and try again.';
    }

    if (query.toLowerCase().includes('search') || query.toLowerCase().includes('find')) {
      console.log('Executing JIRA search');
      const response = await jira.findIssue(`${jiraConfig.project}-1`);
      console.log('JIRA search results:', JSON.stringify(response, null, 2));
      return `Found issue: ${response.key}\nSummary: ${response.fields.summary}\nStatus: ${response.fields.status.name}`;
    } else if (query.toLowerCase().includes('sprint')) {
      console.log('Executing JIRA sprint search');
      const issues = await jira.getAllBoards();
      console.log('JIRA boards:', JSON.stringify(issues, null, 2));
      return `Found ${issues.total} boards`;
    } else {
      return "I can help you with JIRA. Try asking me to:\n- Search for issues\n- Show sprint information\n- List your assigned tasks";
    }
  } catch (error) {
    console.error('Error processing JIRA query:', error);
    if (error.response) {
      console.error('JIRA API Response:', error.response.data);
      return `Sorry, I encountered an error while processing your JIRA request: ${error.response.data.errorMessages?.join(', ') || 'Unknown error'}`;
    }
    return 'Sorry, I encountered an error while processing your JIRA request. Please check your JIRA configuration.';
  }
}

// Helper function to format JIRA response
function formatJiraResponse(issues: any): string {
  return issues.issues.map((issue: any) => {
    return `[${issue.key}] ${issue.fields.summary}\nStatus: ${issue.fields.status.name}\nAssignee: ${issue.fields.assignee?.displayName || 'Unassigned'}\n`;
  }).join('\n');
}

// Handle incoming messages
app.on('message', async ({ send, stream, activity }) => {
  //Get conversation history
  const conversationKey = `${activity.conversation.id}/${activity.from.id}`;
  const messages = storage.get(conversationKey) || [];

  try {
    // First check if the message is JIRA related
    if (activity.text.toLowerCase().includes('jira') || 
        activity.text.toLowerCase().includes('story') || 
        activity.text.toLowerCase().includes('sprint') ||
        activity.text.toLowerCase().includes('task')) {
      const jiraResponse = await handleJiraQuery(activity.text);
      messages.push({ role: 'assistant', content: jiraResponse });
      if (activity.conversation.isGroup) {
        await send(new MessageActivity(jiraResponse).addAiGenerated().addFeedback());
      } else {
        stream.emit(jiraResponse);
        stream.emit(new MessageActivity().addAiGenerated().addFeedback());
      }
      storage.set(conversationKey, messages);
      return;
    }

    const prompt = new ChatPrompt({
      messages,
      instructions,
      model: new OpenAIChatModel({
        model: config.openAIModelName,
        apiKey: config.openAIKey
      })
    })

    if (activity.conversation.isGroup) {
      // If the conversation is a group chat, we need to send the final response
      // back to the group chat
      const response = await prompt.send(activity.text);
      const responseActivity = new MessageActivity(response.content).addAiGenerated().addFeedback();
      await send(responseActivity);
    } else {
        await prompt.send(activity.text, {
          onChunk: (chunk) => {
            stream.emit(chunk);
          },
        });
      // We wrap the final response with an AI Generated indicator
      stream.emit(new MessageActivity().addAiGenerated().addFeedback());
    }
    storage.set(conversationKey, messages);
  } catch (error) {
    console.error(error);
    await send("The agent encountered an error or bug.");
    await send("To continue to run this agent, please fix the agent source code.");
  }
});

app.on('message.submit.feedback', async ({ activity }) => {
  //add custom feedback process logic here
  console.log("Your feedback is " + JSON.stringify(activity.value));
})

export default app;