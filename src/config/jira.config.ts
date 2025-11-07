import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from .env.dev file
dotenv.config({ path: path.join(__dirname, '../../env/.env.dev') });

export interface JiraConfig {
    baseUrl: string;
    token: string;
    email: string;
    project?: string;
}

export const jiraConfig: JiraConfig = {
    baseUrl: process.env.JIRA_BASE_URL || '',
    token: process.env.JIRA_API_TOKEN || '',
    email: process.env.JIRA_EMAIL || '',
    project: process.env.JIRA_PROJECT || ''
};

// Validate configuration
if (!jiraConfig.baseUrl || !jiraConfig.token || !jiraConfig.email) {
    console.error('Missing required JIRA configuration:', {
        hasBaseUrl: !!jiraConfig.baseUrl,
        hasToken: !!jiraConfig.token,
        hasEmail: !!jiraConfig.email,
        hasProject: !!jiraConfig.project
    });
    console.log('Current environment:', process.env.NODE_ENV);
    console.log('Config file path:', path.join(__dirname, '../../env/.env.dev'));
}