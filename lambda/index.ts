import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { Client } from 'pg';

// Interface for the database secret structure
interface DbSecret {
    username: string;
    password: string;
    engine?: string;
    host?: string;
    port?: number;
    dbname?: string;
}

const secretsClient = new SecretsManagerClient({
    region: process.env.AWS_REGION,
});

export const handler = async (): Promise<{ statusCode: number; body: string }> => {
    console.log("Lambda function started...");

    const secretArn: string | undefined = process.env.DB_SECRET_ARN;
    const dbHost: string | undefined = process.env.DB_HOST;

    console.log("Environment Variables:", { DB_SECRET_ARN: secretArn, DB_HOST: dbHost });

    if (!secretArn || !dbHost) {
        console.error("❌ Missing environment variables!");
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Missing environment variables DB_SECRET_ARN or DB_HOST" }),
        };
    }

    try {
        console.log("🔍 Fetching database credentials from AWS Secrets Manager...");
        const secretData = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretArn }));

        console.log('SecretString',secretData.SecretString);

        if (!secretData.SecretString) {
            throw new Error("SecretString is empty");
        }

        console.log("✅ Successfully retrieved secret from AWS Secrets Manager.");
        const secret: DbSecret = JSON.parse(secretData.SecretString);

        console.log("🔍 Parsed secret data:", secret);

        // Create a PostgreSQL client
        console.log("🔧 Creating PostgreSQL client...");
        const client = new Client({
            host: dbHost,
            database: secret.dbname || 'devdb',
            user: secret.username,
            password: secret.password,
            port: secret.port || 5432,
            ssl: { rejectUnauthorized: false },
        });

        console.log("🔌 Connecting to the database...");
        await client.connect();
        console.log("✅ Connected to PostgreSQL database!");

        console.log("📝 Running test query...");
        const res = await client.query('SELECT NOW() AS current_time');
        console.log("✅ Query successful:", res.rows[0]);

        console.log("🔌 Closing database connection...");
        await client.end();
        console.log("✅ Database connection closed.");

        console.log("🎉 Lambda execution completed successfully!");
        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Connected!', time: res.rows[0].current_time }),
        };
    } catch (error) {
        console.error("❌ Error occurred:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: (error as Error).message }),
        };
    }
};
