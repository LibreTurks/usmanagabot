import { In } from 'typeorm';
import { normalizeText } from '@utils/string';
import { CronBase } from './base';
import { Config } from '@services/config';
import { Earthquake, EarthquakeLogs, EarthquakeSubscription } from '@src/types/database/entities/earthquake';
import { Colors, EmbedBuilder } from 'discord.js';

class EarthquakeCron extends CronBase {
    protected readonly name = 'earthquake';

    public async cronjob(): Promise<void> {
        this.log('debug', 'cronjob.start');
        const earthquake = await this.db.find(Earthquake, { where: { is_enabled: true } });
        if (!earthquake || !earthquake.length) {
            this.log('debug', 'configuration.missing');
            return;
        }

        const client = this.createDiscordClient();
        await this.loginDiscordClient(client, Config.current_botcfg.token);

        let delivered_count = 0;
        for (const guild of earthquake) {
            if (!guild.channel_id || !guild.seismicportal_api_url) continue;
            const earthquakes = await this.db.find(EarthquakeLogs, { where: { from_guild: guild.from_guild } });
            const request = (await (await fetch(guild.seismicportal_api_url)).json()) as {
                features: {
                    id: string;
                    properties: { time: Date; mag: number; lat: number; lon: number; auth: string };
                }[];
            };

            let recent_earthquakes = request.features
                .filter((eq) => eq.properties.mag >= guild.magnitude_limit)
                .slice(0, 25);
            if (recent_earthquakes.length === 0) continue;
            if (earthquakes.length) {
                recent_earthquakes = recent_earthquakes.filter((eq) => !earthquakes.find((e) => e.source_id === eq.id));
            }

            for (const eq of recent_earthquakes.slice(0, 25)) {
                const existing_log = await this.db.findOne(EarthquakeLogs, {
                    where: { source_id: eq.id, from_guild: guild.from_guild },
                });
                if (existing_log?.is_delivered) continue;

                const geo_response = (await (
                    await fetch(
                        `https://us1.api-bdc.net/data/reverse-geocode-client?latitude=${eq.properties.lat}&longitude=${eq.properties.lon}&localityLanguage=${guild.region_code}`,
                    )
                ).json()) as { locality?: string; city?: string; principalSubdivision?: string };

                const geo_translate = geo_response.locality || geo_response.city || geo_response.principalSubdivision;

                const locations = [geo_response.locality, geo_response.city, geo_response.principalSubdivision]
                    .filter((loc): loc is string => !!loc)
                    .map((loc) => normalizeText(loc));

                const subscribed_user_ids: bigint[] = [];
                if (locations.length > 0) {
                    const subscriptions = await this.db.find(EarthquakeSubscription, {
                        where: {
                            guild: { gid: guild.from_guild.gid },
                            city: In(locations),
                        },
                    });

                    if (subscriptions.length > 0) {
                        subscribed_user_ids.push(...new Set(subscriptions.map((sub) => sub.user.uid)));
                    }
                }

                let content = '';
                if (guild.ping_role_id) {
                    content = `<@&${guild.ping_role_id}>`;
                }

                if (guild.everyone_ping_threshold !== null && eq.properties.mag >= guild.everyone_ping_threshold) {
                    content = (content ? content + ' ' : '') + '@everyone';
                }

                const post = new EmbedBuilder();
                post.setTitle(
                    `:warning: ${this.t.commands({ key: 'execute.title', guild_id: BigInt(guild.from_guild.gid) })}`,
                );
                post.setColor(Colors.Yellow);
                post.setTimestamp();
                post.addFields(
                    {
                        name: this.t.commands({ key: 'execute.time', guild_id: BigInt(guild.from_guild.gid) }),
                        value: new Date(eq.properties.time).toLocaleString(),
                        inline: true,
                    },
                    {
                        name: this.t.commands({ key: 'execute.id', guild_id: BigInt(guild.from_guild.gid) }),
                        value: eq.id,
                        inline: true,
                    },
                    {
                        name: this.t.commands({ key: 'execute.location', guild_id: BigInt(guild.from_guild.gid) }),
                        value: geo_translate || 'Unknown',
                        inline: true,
                    },
                    {
                        name: this.t.commands({ key: 'execute.source', guild_id: BigInt(guild.from_guild.gid) }),
                        value: eq.properties.auth,
                        inline: true,
                    },
                    {
                        name: this.t.commands({ key: 'execute.magnitude', guild_id: BigInt(guild.from_guild.gid) }),
                        value: eq.properties.mag.toString(),
                        inline: true,
                    },
                    {
                        name: this.t.commands({ key: 'execute.coordinates', guild_id: BigInt(guild.from_guild.gid) }),
                        value: `Lat: ${eq.properties.lat}\nLon: ${eq.properties.lon}`,
                        inline: true,
                    },
                    {
                        name: this.t.commands({ key: 'execute.link', guild_id: BigInt(guild.from_guild.gid) }),
                        value: `https://www.seismicportal.eu/eventdetails.html?unid=${eq.id}`,
                    },
                    {
                        name: this.t.commands({
                            key: 'execute.other_earthquakes',
                            guild_id: BigInt(guild.from_guild.gid),
                        }),
                        value: 'https://deprem.core.xeome.dev',
                    },
                );
                const channel = await client.guilds
                    .fetch(guild.from_guild.gid.toString())
                    .then((g) => g.channels.fetch(guild.channel_id!));
                if (channel && channel.isTextBased()) {
                    const old_logs = await this.db.find(EarthquakeLogs, {
                        where: { from_guild: guild.from_guild },
                        order: { timestamp: 'DESC' },
                    });
                    if (old_logs.length > 50) {
                        for (const old_log of old_logs.slice(50)) await this.db.remove(old_log);
                    }

                    const logs = new EarthquakeLogs();
                    logs.source_id = eq.id;
                    logs.source_name = eq.properties.auth;
                    logs.from_guild = guild.from_guild;
                    await channel
                        .send({ content: content || undefined, embeds: [post] })
                        .then(async () => {
                            logs.is_delivered = true;
                            delivered_count++;

                            for (const uid of subscribed_user_ids) {
                                try {
                                    const user = await client.users.fetch(uid.toString());
                                    if (user) {
                                        await user.send({ embeds: [post] });
                                    }
                                } catch (error) {
                                    this.log('debug', 'cronjob.dm.failed', {
                                        user: uid,
                                        error: (error as Error).message,
                                    });
                                }
                            }
                        })
                        .catch(() => {
                            logs.is_delivered = false;
                        });
                    await this.db.save(logs);
                }
            }
        }
        this.log('debug', 'cronjob.success', { guild: earthquake.length, count: delivered_count });
        await client.destroy();
    }
}

const worker = new EarthquakeCron();

export default {
    async scheduled(): Promise<void> {
        await CronBase.init();
        await worker.cronjob();
    },
};
