import { Router } from 'express';
import type { AgentCard } from '@bx/a2a-sdk';

const router = Router();

const GATEWAY_URL = process.env.GATEWAY_URL ?? 'http://localhost:3000';

router.get('/agent.json', (_req, res) => {
  const card: AgentCard = {
    name: 'Business Exchange Agent',
    description:
      'The Business Exchange platform agent. Partner agents can use this agent to autonomously ' +
      'discover the platform, negotiate integration terms, configure schemas and webhooks, and ' +
      'go live without human involvement.',
    url: `${GATEWAY_URL}/a2a`,
    version: '1.0.0',
    documentationUrl: `${GATEWAY_URL}/docs`,
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    authentication: {
      schemes: ['apiKey'],
      credentials: 'Pass your API key in the x-api-key request header.',
    },
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    skills: [
      {
        id: 'partner_onboarding',
        name: 'Partner Onboarding',
        description:
          'Autonomously negotiate and complete a full partner integration: schema inference, ' +
          'mapping proposal, subscription selection, webhook configuration, and credential issuance.',
        tags: ['onboarding', 'integration', 'schema', 'webhook'],
        examples: [
          'We produce purchase orders in JSON and want to receive invoice confirmations.',
          'Onboard us to the exchange. Here is a sample payload from our ERP.',
        ],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
      },
      {
        id: 'schema_mapping',
        name: 'Schema Mapping',
        description:
          'Submit a sample payload and receive AI-generated mapping rules with confidence scores.',
        tags: ['schema', 'mapping', 'ai'],
        examples: ['Infer the schema for this JSON payload and propose CDM mapping rules.'],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
      },
      {
        id: 'subscription_discovery',
        name: 'Subscription Discovery',
        description: 'Discover available data feeds and subscribe to relevant ones.',
        tags: ['subscription', 'discovery'],
        examples: ['What data feeds are available on this platform?'],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
      },
    ],
  };
  res.json(card);
});

export { router as agentCardRouter };
