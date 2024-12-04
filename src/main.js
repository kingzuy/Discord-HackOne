import 'dotenv/config';
import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';

class HackerOneDiscordBot {
    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent
            ]
        });

        this.initializeFiles();
        this.logFile = path.join(process.cwd(), 'log.txt');
        this.channelFile = path.join(process.cwd(), 'channel.txt');
        this.setupClientEvents();
    }

    setupClientEvents() {
        this.client.on('ready', () => {
            console.log(`Logged in as ${this.client.user.tag}`);
            this.startHacktivityMonitoring();
        });

        this.client.on('messageCreate', async (message) => {
            if (message.content === '.setup') {
                await this.setupMonitoringChannel(message);
            }
        });
    }

    async setupMonitoringChannel(message) {
        if (!message.member.permissions.has('Administrator')) {
            return message.reply('Only administrators can set monitoring channel');
        }

        const channelId = message.channel.id;
        await fs.writeFile(this.channelFile, channelId);
        message.reply(`Channel ${channelId} set for HackerOne monitoring`);
    }

    async startHacktivityMonitoring() {
        try {
            const channelId = await fs.readFile(this.channelFile, 'utf8');
            const channel = this.client.channels.cache.get(channelId);

            if (!channel) {
                console.error('Monitoring channel not found');
                return;
            }

            // Initial check and then interval
            await this.checkHacktivityReports(channel);
            setInterval(async () => {
                await this.checkHacktivityReports(channel);
            }, 15 * 60 * 1000);
        } catch (error) {
            console.error('Monitoring setup error:', error);
        }
    }

    async checkHacktivityReports(channel) {
        try {
            const req = await axios.post("https://hackerone.com/graphql", {
                operationName: "HacktivitySearchQuery",
                variables: {
                    queryString: "disclosed:true",
                    size: 25,
                    from: 0,
                    sort: {
                        field: "latest_disclosable_activity_at",
                        direction: "DESC"
                    }
                },
                query: `query HacktivitySearchQuery($queryString: String!, $from: Int, $size: Int, $sort: SortInput!) {
                search(index: CompleteHacktivityReportIndex, query_string: $queryString, from: $from, size: $size, sort: $sort) {
                    nodes {
                        ... on HacktivityDocument {
                            report {
                                databaseId: _id
                                title
                                url
                                report_generated_content {
                                    hacktivity_summary
                                }
                            }
                            reporter {
                                username
                            }
                            team {
                                name
                                handle
                                currency
                            }
                            severity_rating
                            total_awarded_amount
                        }
                    }
                }
            }`
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.HACKONE_API_KEY}`
                }
            });

            const log = await fs.readFile(this.logFile, 'utf8');

            for (const node of req.data.data.search.nodes) {
                const reportId = node.report.databaseId;

                if (log.includes(reportId)) {
                    console.log(`${reportId} skipping...`);
                    continue;
                }

                const embed = this.createReportEmbed(node);
                await channel.send({ embeds: [embed] });

                await fs.appendFile(this.logFile, `${reportId}\n`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        } catch (error) {
            console.error('Detailed error:', error.response?.data || error.message);
        }
    }

    createReportEmbed(node) {
        const report = node.report;
        const summary = report.report_generated_content?.hacktivity_summary || 'No summary';

        return new EmbedBuilder()
            .setTitle(report.title)
            .setURL(report.url)
            .setDescription(
                `:pencil: Disclosed by [@${node.reporter.username}](https://hackerone.com/${node.reporter.username}) ` +
                `to [**${node.team.name}**](https://hackerone.com/${node.team.handle})\n\n` +
                summary
            )
            .setColor(this.getSeverityColor(node.severity_rating))
            .addFields(
                {
                    name: 'Severity',
                    value: this.getSeverityIcon(node.severity_rating),
                    inline: true
                },
                {
                    name: 'Bounty',
                    value: this.formatBounty(node.total_awarded_amount, node.team.currency),
                    inline: true
                }
            );
    }

    getSeverityIcon(severity) {
        const icons = {
            'None': ':white_circle: Info',
            'Low': ':green_circle: Low',
            'Medium': ':yellow_circle: Medium',
            'High': ':orange_circle: High',
            'Critical': ':red_circle: Critical'
        };
        return icons[severity] || '-';
    }

    getSeverityColor(severity) {
        const colors = {
            'Critical': 0xFF0000,
            'High': 0xFF6600,
            'Medium': 0xFFFF00,
            'Low': 0x00FF00,
            'None': 0x808080
        };
        return colors[severity] || 0x000000;
    }

    formatBounty(amount, currency) {
        return `💰 ${new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currency
        }).format(amount)}`;
    }

    async initializeFiles() {
        // Buat file log jika tidak ada
        try {
            await fs.access(this.logFile);
        } catch (error) {
            await fs.writeFile(this.logFile, '');
            console.log('Log file created');
        }

        // Buat file channel jika tidak ada
        try {
            await fs.access(this.channelFile);
        } catch (error) {
            console.log('Channel file not found. Please use .setup command to set monitoring channel');
        }
    }

    async start() {
        await this.client.login(process.env.DISCORD_BOT_TOKEN);
    }
}

const bot = new HackerOneDiscordBot();
bot.start();