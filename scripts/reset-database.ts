import "dotenv/config";
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

// Initialize AWS Secrets Manager client
const secretsClient = new SecretsManagerClient({
    region: process.env.AWS_REGION,
});

/**
 * Fetch database credentials from AWS Secrets Manager.
 */
const getDbCredentials = async (): Promise<DbSecret> => {
    const secretArn = process.env.DB_SECRET_ARN;
    if (!secretArn) {
        throw new Error("Missing DB_SECRET_ARN environment variable.");
    }

    const secretData = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretArn }));

    if (!secretData.SecretString) {
        throw new Error("SecretString is empty.");
    }

    return JSON.parse(secretData.SecretString);
};

/**
 * Drops all tables and views.
 */
const dropAllTablesAndViews = async (client: Client) => {
    console.log("⚠️ Dropping all views...");
    await client.query(`DROP VIEW IF EXISTS metadata_view CASCADE;`);

    console.log("⚠️ Dropping all tables...");
    await client.query(`DO $$ 
        DECLARE 
            r RECORD;
        BEGIN 
            FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
                EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
            END LOOP;
        END $$;
    `);
    console.log("✅ All tables and views dropped.");
};

/**
 * Creates the database schema.
 */
const createSchema = async (client: Client) => {
    console.log("🚀 Creating database schema...");
    await client.query(`
        CREATE TABLE category (
            id UUID PRIMARY KEY,
            metadata JSONB
        );

        CREATE TABLE model_category (
            model_id UUID,
            category_id UUID REFERENCES category(id),
            PRIMARY KEY (model_id, category_id)
        );

        CREATE TABLE condition (
            id UUID PRIMARY KEY
        );

        CREATE TABLE category_condition (
            category_id UUID REFERENCES category(id),
            condition_id UUID REFERENCES condition(id),
            PRIMARY KEY (category_id, condition_id)
        );

        CREATE TABLE field (
            id UUID PRIMARY KEY,
            datatype TEXT,
            metadata JSONB,
            validation JSONB,
            search JSONB
        );

        CREATE TABLE category_field (
            category_id UUID REFERENCES category(id),
            field_id UUID REFERENCES field(id),
            is_required BOOLEAN,
            PRIMARY KEY (category_id, field_id)
        );

        CREATE TABLE domain_value (
            id UUID PRIMARY KEY,
            field_id UUID REFERENCES field(id),
            name TEXT
        );

        CREATE TABLE condition_domain_value (
            condition_id UUID REFERENCES condition(id),
            condition_group_id UUID,
            domain_value_id UUID REFERENCES domain_value(id),
            field_id UUID REFERENCES field(id),
            PRIMARY KEY (condition_id, domain_value_id)
        );

        CREATE TABLE tabular_group (
            id UUID PRIMARY KEY
        );

        CREATE TABLE category_tabular_group (
            category_id UUID REFERENCES category(id),
            tabular_id UUID REFERENCES tabular_group(id),
            validation JSONB,
            PRIMARY KEY (category_id, tabular_id)
        );

        CREATE TABLE tabular_group_field (
            tabular_group_id UUID REFERENCES tabular_group(id),
            field_id UUID REFERENCES field(id),
            field_order INTEGER,
            PRIMARY KEY (tabular_group_id, field_id)
        );
    `);
    console.log("✅ Database schema created.");
};

/**
 * Creates metadata view and associated triggers.
 */
const createMetadataView = async (client: Client) => {
    console.log("🛠 Creating metadata view and triggers...");

    await client.query(`
        -- Drop existing view
        DROP VIEW IF EXISTS metadata_view CASCADE;

        -- Create metadata_view
        CREATE VIEW metadata_view AS
        SELECT 
            c.id AS category_id,
            c.metadata AS category_metadata,
            jsonb_agg(DISTINCT m.model_id) FILTER (WHERE m.model_id IS NOT NULL) AS model_ids,
            jsonb_agg(
                DISTINCT jsonb_build_object(
                    'fieldId', f.id,
                    'datatype', f.datatype,
                    'metadata', f.metadata,
                    'validation', f.validation,
                    'search', f.search,
                    'isRequired', cf.is_required
                )
            ) FILTER (WHERE f.id IS NOT NULL) AS fields,
            jsonb_agg(
                DISTINCT jsonb_build_object(
                    'conditionId', cond.id,
                    'domainValues', (
                        SELECT jsonb_agg(
                            jsonb_build_object(
                                'domainValueId', cdv.domain_value_id,
                                'conditionGroupId', cdv.condition_group_id,
                                'fieldId', cdv.field_id
                            )
                        ) FROM condition_domain_value cdv WHERE cdv.condition_id = cond.id
                    )
                )
            ) FILTER (WHERE cond.id IS NOT NULL) AS conditions,
            jsonb_agg(
                DISTINCT jsonb_build_object(
                    'tabularGroupId', tg.id,
                    'validation', ctg.validation
                )
            ) FILTER (WHERE tg.id IS NOT NULL) AS tabularGroups
        FROM category c
        LEFT JOIN model_category m ON c.id = m.category_id
        LEFT JOIN category_field cf ON c.id = cf.category_id
        LEFT JOIN field f ON cf.field_id = f.id
        LEFT JOIN category_condition cc ON c.id = cc.category_id
        LEFT JOIN condition cond ON cc.condition_id = cond.id
        LEFT JOIN category_tabular_group ctg ON c.id = ctg.category_id
        LEFT JOIN tabular_group tg ON ctg.tabular_id = tg.id
        GROUP BY c.id, c.metadata;

        -- Triggers for insert, update, delete on metadata_view
        CREATE OR REPLACE FUNCTION metadata_view_insert_trigger() RETURNS TRIGGER AS $$
        BEGIN
            INSERT INTO category (id, metadata) VALUES (gen_random_uuid(), NEW.category_metadata);
            RETURN NULL;
        END $$ LANGUAGE plpgsql;
        CREATE TRIGGER metadata_view_insert INSTEAD OF INSERT ON metadata_view FOR EACH ROW EXECUTE FUNCTION metadata_view_insert_trigger();

        CREATE OR REPLACE FUNCTION metadata_view_update_trigger() RETURNS TRIGGER AS $$
        BEGIN
            UPDATE category SET metadata = NEW.category_metadata WHERE id = NEW.category_id;
            RETURN NULL;
        END $$ LANGUAGE plpgsql;
        CREATE TRIGGER metadata_view_update INSTEAD OF UPDATE ON metadata_view FOR EACH ROW EXECUTE FUNCTION metadata_view_update_trigger();

        CREATE OR REPLACE FUNCTION metadata_view_delete_trigger() RETURNS TRIGGER AS $$
        BEGIN
            DELETE FROM category WHERE id = OLD.category_id;
            RETURN NULL;
        END $$ LANGUAGE plpgsql;
        CREATE TRIGGER metadata_view_delete INSTEAD OF DELETE ON metadata_view FOR EACH ROW EXECUTE FUNCTION metadata_view_delete_trigger();
    `);

    console.log("✅ Metadata view and triggers created.");
};

/**
 * Inserts an initial category entry.
 */
const insertInitialData = async (client: Client) => {
    console.log("📝 Inserting initial category...");
    const res = await client.query(`
        INSERT INTO category (id, metadata)
        VALUES (
            gen_random_uuid(), 
            '{"name": "New Category", "description": "This is a sample category"}'
        )
        RETURNING *;
    `);
    console.log("✅ Inserted category:", res.rows[0]);
};

/**
 * Tests inserting a new category via `metadata_view`
 */
const testInsertMetadata = async (client: Client) => {
    console.log("📝 Testing INSERT via metadata_view...");
    const res = await client.query(`
        INSERT INTO metadata_view (category_metadata, model_ids, fields, conditions, tabularGroups)
        VALUES (
            '{"name": "Test Category", "description": "Inserted via metadata_view"}',
            '["3e0b51d3-34c4-4f8b-a1a1-123456789abc"]',
            '[{"fieldId": "4f8b5678-89ab-4cde-b012-abcdef123456", "datatype": "text", "metadata": "{}", "validation": "{}", "search": "{}", "isRequired": true}]',
            '[{"conditionId": "98765432-1234-4abc-8def-abcdefabcdef"}]',
            '[{"tabularGroupId": "5a7b8c9d-6e0f-4g1h-ijkl-mnopqrstuvwx", "validation": "{}"}]'
        )
        RETURNING *;
    `);
    console.log("✅ Inserted via metadata_view:", res.rows[0]);
};

/**
 * Tests selecting data from `metadata_view`
 */
const testSelectMetadata = async (client: Client) => {
    console.log("🔍 Testing SELECT from metadata_view...");
    const res = await client.query(`SELECT * FROM metadata_view;`);
    console.log("✅ Retrieved metadata:", res.rows);
};

/**
 * Tests updating metadata in `metadata_view`
 */
const testUpdateMetadata = async (client: Client) => {
    console.log("✏️ Testing UPDATE via metadata_view...");
    const res = await client.query(`
        UPDATE metadata_view
        SET category_metadata = '{"name": "Updated Category", "description": "Updated via metadata_view"}'
        WHERE category_id = (SELECT category_id FROM metadata_view LIMIT 1)
        RETURNING *;
    `);
    console.log("✅ Updated category via metadata_view:", res.rows[0]);
};

/**
 * Tests deleting metadata via `metadata_view`
 */
const testDeleteMetadata = async (client: Client) => {
    console.log("🗑️ Testing DELETE via metadata_view...");
    const res = await client.query(`
        DELETE FROM metadata_view WHERE category_id = (SELECT category_id FROM metadata_view LIMIT 1)
        RETURNING *;
    `);
    console.log("✅ Deleted category via metadata_view:", res.rows[0]);
};

/**
 * Main function to reset the database.
 */
export const resetDatabase = async () => {
    console.log("🔄 Resetting database...");

    const secret = await getDbCredentials();
    const client = new Client({
        host: secret.host,
        database: secret.dbname,
        user: secret.username,
        password: secret.password,
        port: secret.port || 5432,
        ssl: { rejectUnauthorized: false },
    });

    try {
        await client.connect();
        console.log("✅ Connected to database!");

        // Drop all tables and views
        await dropAllTablesAndViews(client);

        // Recreate schema
        await createSchema(client);

        // Create metadata view and triggers
        await createMetadataView(client);

        console.log("🚀 Running tests...");
        await testInsertMetadata(client);
        await testSelectMetadata(client);
        await testUpdateMetadata(client);
        await testDeleteMetadata(client);
        console.log("✅ All tests completed successfully!");

        console.log("🎉 Database successfully reset!");
    } catch (error) {
        console.error("❌ Error resetting database:", error);
    } finally {
        await client.end();
        console.log("🔌 Database connection closed.");
    }
};

// Execute when running the script directly
if (require.main === module) {
    resetDatabase().catch(console.error);
}

