import { BaseChannel, Guild, Locale, User } from 'discord.js';
import { readFile } from 'fs/promises';
import { glob } from 'glob';
import jsonc from 'jsonc-parser';
import path from 'path';

/**
 * Supported languages for localization files under src/localization.
 */
export enum SupportedLanguages {
    AUTO = 'auto',
    EN_US = Locale.EnglishUS,
    TR = Locale.Turkish,
}

/**
 * A static class for localized message lookup with in-memory caching.
 *
 * Features:
 * - **In-Memory Caching**: All translation files are loaded into a static cache at startup for high performance.
 * - **Guild-Specific Languages**: Supports different language preferences for each Discord server.
 * - **Fallback Mechanism**: Provides robust fallbacks for missing translation keys.
 * - **Placeholder Replacement**: Dynamically replaces placeholders like `{user}` with formatted values.
 *
 * All methods are static. `Translator.init()` should be called at startup to populate the translation cache.
 */
export class Translator {
    /**
     * The default language used when a guild-specific language is not available.
     * @private
     */
    private static current_language: SupportedLanguages = SupportedLanguages.EN_US;

    /**
     * A static cache holding all translations, keyed by language.
     * The cache is populated at startup and is read-only during runtime.
     * @private
     */
    private static translation_cache: Map<
        string,
        {
            commands: { [key: string]: object };
            events: { [key: string]: object };
            services: { [key: string]: object };
            system: { [key: string]: object };
        }
    > = new Map();

    /**
     * A static cache for guild-specific language preferences to reduce database queries.
     * @private
     */
    private static guild_language_cache: Map<bigint, Locale> = new Map();

    /**
     * Formats a Discord entity (User, Channel, Guild) into a readable string like "name (#id)".
     * @private
     * @param {BaseChannel | Guild | User} entity The Discord entity to format.
     * @returns {string} The formatted string.
     */
    private static formatDiscordEntity(entity: BaseChannel | Guild | User): string {
        if (!entity) return 'Unknown';

        if (typeof entity === 'object' && entity !== null) {
            if (entity instanceof BaseChannel) {
                return `Channel (<#${entity.id}>)`;
            } else if (entity instanceof Guild) {
                return `${entity.name} (<@${entity.id}>)`;
            } else if (entity instanceof User) {
                return `${entity.username} (<@${entity.id}>)`;
            }
        }
        return String(entity);
    }

    /**
     * Initializes the translation cache by asynchronously reading all `.jsonc` files
     * from the `src/localization` directory and loading them into memory.
     * This method should be called once at startup.
     * @public
     * @static
     */
    public static async init(): Promise<void> {
        const languages = Object.values(SupportedLanguages);
        for (const lang of languages.filter((l) => l !== SupportedLanguages.AUTO)) {
            const lang_cache = {
                commands: {},
                system: {},
                services: {},
                events: {},
            };

            for (const section of Object.keys(lang_cache)) {
                const dir = path.join(__dirname, `../localization/${lang}/${section}`);
                const files = await glob(`${dir}/**/*.jsonc`);
                for (const file of files) {
                    const content = jsonc.parse(await readFile(file, 'utf-8'));
                    if (section === 'commands') {
                        Object.assign(lang_cache.commands, content);
                    } else {
                        Object.assign(lang_cache[section as keyof typeof lang_cache], content);
                    }
                }
            }

            Translator.translation_cache.set(lang, lang_cache);
        }
    }

    /**
     * Resolves a nested key from a translation object (e.g., 'ping.execute.measuring').
     * @private
     * @static
     * @param {unknown} obj The object to search within.
     * @param {string} key The dot-separated key path.
     * @returns {string | null} The resolved string value, or `null` if not found.
     */
    private static resolveNestedKey(obj: object, key: string): string | null {
        const parts = key.split('.');
        let current: unknown = obj;

        for (const part of parts) {
            if (current && typeof current === 'object' && part in current) {
                current = (current as Record<string, unknown>)[part];
            } else {
                return null;
            }
        }

        return typeof current === 'string' ? current : null;
    }

    /**
     * Generates a translation lookup function for a specific namespace and caller.
     * The returned function can be used to fetch localized strings with optional replacements.
     * @public
     * @static
     * @param {{ caller: string; lang?: SupportedLanguages }} o An object containing the caller identifier and optional language override.
     * @returns {{
     *   command: (q: { key: string; replacements?: { [key: string]: unknown }; guild_id?: bigint; lang?: SupportedLanguages }) => string;
     *   event: (q: { key: string; replacements?: { [key: string]: unknown }; guild_id?: bigint; lang?: SupportedLanguages }) => string;
     *   service: (q: { key: string; replacements?: { [key: string]: unknown }; guild_id?: bigint; lang?: SupportedLanguages }) => string;
     *   system: (q: { key: string; replacements?: { [key: string]: unknown }; guild_id?: bigint; lang?: SupportedLanguages }) => string;
     * }} An object containing translation functions for each namespace.
     */
    public static generateQueryFunc(o: { caller: string; lang?: SupportedLanguages }) {
        const makeQuery =
            (namespace: 'commands' | 'events' | 'services' | 'system') =>
                (
                    q: Partial<typeof o> & {
                    key: string;
                    replacements?: { [key: string]: unknown };
                    guild_id?: bigint;
                },
                ): string => {
                    const old_lang = Translator.current_language;
                    let translation;
                    let cache;
                    if (q.lang && q.lang !== SupportedLanguages.AUTO) {
                        Translator.current_language = q.lang;
                    }
                    if (Translator.current_language === SupportedLanguages.AUTO) {
                        const target_lang = Translator.guild_language_cache.get(q.guild_id!) ?? SupportedLanguages.EN_US;
                        cache = Translator.translation_cache.get(target_lang);
                    } else {
                        cache = Translator.translation_cache.get(Translator.current_language);
                    }
                    translation = Translator.resolveNestedKey(cache![namespace][q.caller ?? o.caller], q.key) || q.key;
                    if (q.replacements) {
                        for (const [k, v] of Object.entries(q.replacements)) {
                            const formatted_value =
                            typeof v === 'object' && v !== null
                                ? Translator.formatDiscordEntity(v as BaseChannel | Guild | User)
                                : String(v);
                            translation = translation.replace(new RegExp(`\\{${k}\\}`, 'g'), formatted_value);
                        }
                    }

                    Translator.current_language = old_lang;
                    return translation;
                };

        return {
            commands: makeQuery('commands'),
            events: makeQuery('events'),
            services: makeQuery('services'),
            system: makeQuery('system'),
        };
    }

    /**
     * Sets the default language for the translator.
     * @public
     * @static
     * @param {SupportedLanguages} lang The new default language.
     */
    public static set setLanguage(lang: SupportedLanguages) {
        if (Object.values(SupportedLanguages).includes(lang)) {
            Translator.current_language = lang;
        }
    }

    /**
     * Caches the language preference for a specific guild.
     * @public
     * @static
     * @param {{ id: bigint; language: Locale }} o An object containing the guild ID and its language preference.
     */
    public static set setGuildLanguage(o: { id: bigint; language: Locale }) {
        if (!o.id || !o.language) return;
        if (o.language.toUpperCase() in SupportedLanguages === false) {
            o.language = Locale.EnglishUS;
        }
        Translator.guild_language_cache.set(o.id, o.language);
    }
}
