import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAllowBotMessagesToStarboardSettings1704500000000 implements MigrationInterface {
    name = 'AddAllowBotMessagesToStarboardSettings1704500000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "starboard_settings" ADD COLUMN "allow_bot_messages" boolean NOT NULL DEFAULT false`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "starboard_settings" DROP COLUMN "allow_bot_messages"`);
    }
}
