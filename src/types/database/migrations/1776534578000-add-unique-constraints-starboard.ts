import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUniqueConstraintsStarboard1776534578000 implements MigrationInterface {
    name = 'AddUniqueConstraintsStarboard1776534578000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Deduplicate messages: keep the earliest row per message_id
        await queryRunner.query(`
            DELETE FROM messages m
            USING messages m2
            WHERE m.message_id = m2.message_id
              AND m.id > m2.id
        `);

        // Deduplicate starboard_logs: keep the row with the highest star_count per source_message
        await queryRunner.query(`
            DELETE FROM starboard_logs sl
            USING starboard_logs sl2
            WHERE sl.message_id = sl2.message_id
              AND sl.id < sl2.id
        `);

        // Add unique constraints
        await queryRunner.query(`ALTER TABLE messages ADD CONSTRAINT UQ_messages_message_id UNIQUE (message_id)`);
        await queryRunner.query(
            `ALTER TABLE starboard_logs ADD CONSTRAINT UQ_starboard_logs_message_id UNIQUE (message_id)`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE starboard_logs DROP CONSTRAINT UQ_starboard_logs_message_id`);
        await queryRunner.query(`ALTER TABLE messages DROP CONSTRAINT UQ_messages_message_id`);
    }
}
