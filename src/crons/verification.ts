import { CronBase } from './base';
import { Config } from '@services/config';
import { Guilds } from '@src/types/database/entities/guilds';
import { Verification, VerificationSystem } from '@src/types/database/entities/verification';

class VerificationCron extends CronBase {
    protected readonly name = 'verification';

    public async routineCheck(): Promise<void> {
        this.log('debug', 'cronjob.start');
        const guilds = await this.db.find(Guilds);
        const client = this.createDiscordClient();
        await this.loginDiscordClient(client, Config.current_botcfg.token);
        let verified_count = 0;
        for (const guild of guilds) {
            const verification_system = await this.db.findOne(VerificationSystem, { where: { from_guild: guild } });
            if (!verification_system || !verification_system.is_enabled) continue;
            const verifications = await this.db.find(Verification, {
                where: { from_guild: guild },
            });
            for (const verification of verifications) {
                if (verification.remaining_time.getTime() <= Date.now()) {
                    const g = client.guilds.cache.get(guild.gid.toString());
                    if (!g) continue;
                    const member = await g.members.fetch(verification.from_user.uid.toString()).catch(() => null);
                    if (!member) continue;
                    member.roles.remove(verification_system.role_id);
                    verified_count++;
                    await this.db.delete(Verification, { id: verification.id });
                }
            }
        }
        this.log('debug', 'cronjob.success', { guild: guilds.length, count: verified_count });
        await client.destroy();
    }
}

const worker = new VerificationCron();

export default {
    async scheduled(): Promise<void> {
        await CronBase.init();
        await worker.routineCheck();
    },
};
