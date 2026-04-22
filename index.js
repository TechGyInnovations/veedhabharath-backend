require('dotenv').config();
const express = require('express');
const cors = require('cors');
const routes = require('./routes/routes');
const serverless = require('serverless-http');
// const syncKeycloakRoles = require('./utils/syncKeycloakRoles');

// const { swaggerUi, specs } = require('./utils/swagger');

const app = express();

app.use(express.json());

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Swagger Documentation
// app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs, {
//     explorer: true,
//     customSiteTitle: 'GLC Backend API Docs'
// }));

app.get('/health', (req, res) => {
    res.json({ status: 'OK' });
});

// Sync master_user_roles to Keycloak realm roles on startup (idempotent, non-fatal)
// syncKeycloakRoles();

app.use('/', routes);

// Global 404 Handler for undefined routes
app.use((req, res, next) => {
    res.status(404).json({ error: 'Not Found' });
});

// Global Error Handler for parsing errors and unhandled exceptions
app.use((err, req, res, next) => {
    console.error('[Global Error Handler]', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

// LOCAL RUN MODE
if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const PORT = process.env.PORT || 3000;

    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

// LAMBDA EXPORT MODE
const serverlessHandler = serverless(app);

module.exports.handler = async (event, context) => {
    // 1. Intercept SQS Queue trigger events
    if (event && event.Records && event.Records.length > 0 && event.Records[0].eventSource === 'aws:sqs') {
        console.log(`[Lambda Handler] SQS queue trigger detected. Processing ${event.Records.length} records.`);

        for (const record of event.Records) {
            try {
                const body = JSON.parse(record.body);
                if (body.jobType === 'push_notification') {
                    const worker = require('./notificationWorker');
                    await worker.handler(body);
                } else {
                    console.warn(`[Lambda Handler] Unknown SQS job type: ${body.jobType}`);
                }
            } catch (err) {
                console.error('[Lambda Handler] Failed to process SQS record:', err);
                // Throwing the error ensures SQS will retry this message or move it to a DLQ
                throw err;
            }
        }

        return { statusCode: 200, body: JSON.stringify({ message: "SQS batch processed successfully." }) };
    }

    // 2. Otherwise, treat as API Gateway HTTP request and route to Express
    return serverlessHandler(event, context);
};