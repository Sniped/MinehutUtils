import {
	CommandInteraction,
	ActionRowBuilder,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	ModalSubmitInteraction,
	Channel,
	TextChannel
} from 'discord.js';
import { Discord, ModalComponent, Slash } from 'discordx';
import { clean, createEmbed, embedJoinList } from '../utils/embed';
import { getServerData } from '../utils/minehut';
import ms from 'ms';
import * as modbot from '../services/modbot';
import * as cooldown from '../services/cooldown';
import { config } from '..';
import { getGuildConfig } from '../utils/config';

// We'll keep a cache of advertisements within the last hour, if any server reaches an x amount, we'll block it for the same cooldown as the user
const advertisements: Map<string, number> = new Map();

@Discord()
export class AdvertiseCommand {
	@Slash({ name: 'advertise', description: 'Advertise a server on discord' })
	private async advertise(interaction: CommandInteraction) {
		const modal = new ModalBuilder()
			.setTitle('Advertise your server!')
			.setCustomId('minehut-advertise');

		const serverName = new TextInputBuilder()
			.setCustomId('serverName')
			.setLabel('Minehut Server Name')
			.setStyle(TextInputStyle.Short);

		const description = new TextInputBuilder()
			.setCustomId('description')
			.setLabel('Talk about your server!')
			.setStyle(TextInputStyle.Paragraph);

		modal.addComponents(
			new ActionRowBuilder<TextInputBuilder>().addComponents(serverName),
			new ActionRowBuilder<TextInputBuilder>().addComponents(description)
		);

		interaction.showModal(modal);
	}

	@ModalComponent({ id: 'minehut-advertise' })
	async handle(interaction: ModalSubmitInteraction) {
		const [serverName, description] = ['serverName', 'description'].map((id) =>
			interaction.fields.getTextInputValue(id)
		);

		// Verify server name
		const data = await getServerData(serverName.trim());
		if (data == null)
			return interaction.reply({
				ephemeral: true,
				embeds: [
					createEmbed(`${config.emotes.fail} Server \`${clean(serverName)}\` could not be found`)
				]
			});
		const serverKey = cooldown.generateKey(interaction.guild, `advertise`, `server`, data._id);

		// Verify description length
		const lines = description.split('\n').length;
		if (lines > 25)
			return interaction.reply({
				ephemeral: true,
				embeds: [
					createEmbed(
						`${config.emotes.fail} Description is too long, please keep it to 25 lines or under.`
					).setColor('#ff0000')
				]
			});

		// Run description through modbot
		const filtered = await modbot.isFiltered(interaction.guild, description);
		if (filtered) {
			return interaction.reply({
				ephemeral: true,
				embeds: [
					createEmbed(
						`${config.emotes.fail} Description contains blocked words. Please try again.`
					).setColor('#ff0000')
				]
			});
		}

		// Check if we're on cooldown
		const userKey = cooldown.generateKey(
			interaction.guild,
			`advertise`,
			`user`,
			interaction.user.id
		);

		const duration = ms(config.settings.servers.cooldown);

		let textDuration = duration < 1000 ? `1 second` : ms(duration, { long: true });
		if (textDuration == '1 day') textDuration = '24 hours';

		const userCooldown = await cooldown.isOnCooldown(userKey);
		if (userCooldown)
			return interaction.reply({
				ephemeral: true,
				embeds: [
					createEmbed(
						`${config.emotes.fail} You have already advertised a server in the last ${textDuration}.`
					)
				]
			});

		const serverCooldown = await cooldown.isOnCooldown(serverKey);
		if (serverCooldown)
			return interaction.reply({
				ephemeral: true,
				embeds: [
					createEmbed(
						`${config.emotes.fail} The server \`${data.name}\` has already been advertised in the last ${textDuration}.`
					)
				]
			});

		const body = embedJoinList(
			`<:minehut:583099471320055819> **${data.name}**`,
			``,
			description,
			``,
			`Play at \`${data.name_lower}.minehut.gg\``,
			`<:bedrock:1101261334684901456> Bedrock: \`${data.name_lower}.bedrock.minehut.gg\``,
			``,
			`*Server advertised by <@${interaction.user.id}>*`
		);

		const serverChannelId = getGuildConfig(interaction.guildId).channels.servers;
		const channel = (await interaction.guild.channels.fetch(serverChannelId)) as Channel;

		if (!channel.isTextBased)
			return interaction.reply({
				ephemeral: true,
				embeds: [
					createEmbed(
						`${config.emotes.fail} Server channel is not a text channel. Please contact a moderator.`
					)
				]
			});

		await cooldown.setPersistentCooldown(userKey, duration);
		advertisements.set(data._id, (advertisements.get(data._id) ?? 0) + 1);

		if (advertisements.get(data._id) == config.settings.servers.limit) {
			await cooldown.setPersistentCooldown(serverKey, ms('24 hours'));
			advertisements.delete(data._id);
		}

		setTimeout(() => {
			const current = advertisements.get(data._id) ?? 0;
			if (current == 0) return;

			if (current == 1) advertisements.delete(data._id);
			else advertisements.set(data._id, (advertisements.get(data._id) ?? 0) - 1);
		}, ms('1 hour'));

		const message = await (channel as TextChannel).send({
			embeds: [createEmbed(body)]
		});

		await interaction.reply({
			ephemeral: true,
			embeds: [
				createEmbed(
					embedJoinList(
						` Successfully posted your server advertisement!`,
						`Check it out :point_right: ${message.url}`
					)
				)
			]
		});
	}
}
