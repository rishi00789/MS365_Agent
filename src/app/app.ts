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
import { scoreAcceptanceCriteria } from '../utils/scoreAc'; 
import {jiraFields} from '../constant/constant';
import util from "util";

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
        activity.text.toLowerCase().includes('task') ||
        activity.text.toLowerCase().startsWith('readDescription')){
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

    // Helper function to format score response
    function formatScoreResponse(result: any): string {
      let text = typeof result === 'string' ? result : (result.text || '');
      
      // Remove escaped characters and extra symbols
      text = text.replace(/\\n/g, '\n').replace(/\\t/g, '').replace(/'/g, '').replace(/\+/g, '');
      
      // Split by lines and process
      const lines = text.split('\n');
      let formatted = '';
      
      lines.forEach((line: string) => {
        const trimmed = line.trim();
        
        // Skip empty lines and dashes
        if (!trimmed || trimmed === '---') return;
        
        // Main headers
        if (trimmed.startsWith('###')) {
          formatted += `<br><br><b>${trimmed.replace(/#{1,}/g, '').trim()}</b><br>`;
        }
        // Section titles (Clarity, Structure, Relevance, Testability, Overall Score, etc.)
        else if (trimmed.match(/^-?[A-Z][a-zA-Z\s]+$/) && 
                 !trimmed.startsWith('Score') && 
                 !trimmed.startsWith('Explanation') && 
                 !trimmed.startsWith('Summary') &&
                 !trimmed.startsWith('Given') &&
                 !trimmed.startsWith('When') &&
                 !trimmed.startsWith('Then')) {
          formatted += `<br><b>📌 ${trimmed}</b><br>`;
        }
        // Score and Explanation lines
        else if (trimmed.startsWith('Score') || 
                 trimmed.startsWith('Explanation') || 
                 trimmed.startsWith('Summary')) {
          if (trimmed.startsWith('Score')) {
            formatted += `<i>${trimmed}</i><br>`;
          } else {
            formatted += `${trimmed}<br>`;
          }
        }
        // Any other non-empty line
        else if (trimmed) {
          formatted += `${trimmed}<br>`;
        }
      });
      
      return formatted;
    }

    // Command: /scoreAC - Fetch and score acceptance criteria from JIRA
    if (activity.text.toLowerCase().startsWith('/scoreac')) {
  const issueKey = activity.text.split(' ')[1];
  if (!issueKey) {
    stream.emit("Please provide a JIRA issue key like `/scoreAC ABC-123`");
    return;
  }

  try {
    const issue = await jira.findIssue(issueKey);
    const fields = await jira.listFields();
    console.log(fields);

    const description = issue.fields[jiraFields.AC]?.content?.map((block: any) =>
      block.content?.map((c: any) => c.text).join(' ')
    ).join('\n') || 'No description found.';
    
       
    if(description==='No description found.'){
      stream.emit(`❌ No acceptance criteria found for issue ${issueKey}. Please check the key and try again.`);
      return;
    }else{
    const result = await scoreAcceptanceCriteria(description );
    stream.emit(`✅ Fetched and scoring acceptance criteria for issue ${issueKey}`);
      stream.emit(`<br><b>📋 Acceptance Criteria:</b><br>${description}`);
      
      const formattedScore = formatScoreResponse(result);
      stream.emit(`<br><b>🎯 Score Assessment:</b>${formattedScore}`);
      stream.emit(new MessageActivity().addAiGenerated().addFeedback());
    }
  } catch (err) {
    console.error(err);
    stream.emit(`❌ Failed to fetch description for issue ${issueKey}. Please check the key and try again.`);
  }
  return;
}

    // Command: /fetchAC - Fetch acceptance criteria from JIRA without scoring
    if (activity.text.toLowerCase().startsWith('/fetchac')) {
  const issueKey = activity.text.split(' ')[1];
  if (!issueKey) {
    stream.emit("Please provide a JIRA issue key like `/fetchAC ABC-123`");
    return;
  }

  try {
    const issue = await jira.findIssue(issueKey);
    const description = issue.fields[jiraFields.AC]?.content?.map((block: any) =>
      block.content?.map((c: any) => c.text).join(' ')
    ).join('\n') || 'No description found.';
    
    if(description==='No description found.'){
      stream.emit(`❌ No acceptance criteria found for issue ${issueKey}. Please check the key and try again.`);
      return;
    }else{
      stream.emit(`✅ Fetched acceptance criteria for issue ${issueKey}`);
      stream.emit(`<br><b>📋 Acceptance Criteria:</b><br>${description}`);
      stream.emit(new MessageActivity().addAiGenerated().addFeedback());
    }
  } catch (err) {
    console.error(err);
    stream.emit(`❌ Failed to fetch acceptance criteria for issue ${issueKey}. Please check the key and try again.`);
  }
  return;
}
    // Command: /scoreThisAC - Score provided acceptance criteria string
    if (activity.text.toLowerCase().startsWith('/scorethisac')) {
  const acString = activity.text.substring('/scorethisac'.length).trim();
  if (!acString) {
    stream.emit("Please provide acceptance criteria to score. Example: `/scoreThisAC Given a user login page, when user enters valid credentials, then user should be logged in`");
    return;
  }

  try {
    const result = await scoreAcceptanceCriteria(acString);
    stream.emit(`Scoring provided acceptance criteria...`);
    stream.emit(`<br><b>📋 Acceptance Criteria:</b><br>${acString}`);
    
    const formattedScore = formatScoreResponse(result);
    stream.emit(`<br><b>🎯 Score Assessment:</b>${formattedScore}`);
    stream.emit(new MessageActivity().addAiGenerated().addFeedback());
  } catch (err) {
    console.error(err);
    stream.emit(`❌ Failed to score the provided acceptance criteria. Please try again.`);
  }
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