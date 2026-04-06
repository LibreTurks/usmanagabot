import { CronJob } from 'cron';
import { CommandLoader } from '../../commands';

export function Cron(options: { schedule: string; on_complete?: (...args: unknown[]) => void }): MethodDecorator {
    return (target_class, property_key, descriptor_func) => {
        new CronJob(
            options.schedule,
            (...args: unknown[]) => {
                if (typeof descriptor_func.value !== 'function') return;
                const guild_command = [...CommandLoader.BotCommands.values()].flatMap((cmd_map) => [...cmd_map.values()]);
                const target = guild_command.find((cmd) => Object.getPrototypeOf(cmd) === target_class);
                descriptor_func.value.apply(target, args);
            },
            options.on_complete ?? null,
            true,
        );
    };
}
