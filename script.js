require('node-limited')();

// Variables and requires and stuff.
var colors = require("colors");
var fs = require("fs");
var request = require("request");
var tmi = require("tmi.js");

var debug = false;

var Beam = require('beam-client-node');
var BeamSocket = require('beam-client-node/lib/ws');
//Beam messages should be decoded for safety
var ent = require('ent');

var accounts = JSON.parse(fs.readFileSync("accounts.json", "utf8"));
var channels = JSON.parse(fs.readFileSync("channels.json", "utf8"));
var supportedAccounts = JSON.parse(fs.readFileSync("supportedAccounts.json", "utf8"));["smblive"];

var beam = new Beam();
var twitch = new tmi.client({
	connection: {
		reconnect: true
	},
	identity: {
		username: accounts.twitch.user,
		password: accounts.twitch.pass
	},
	channels: (function() {
		var i = [];
		for(var j = 0; j < channels.length; j++) {
			i.push(channels[j].twitch);
		}
		return i;
	}())
});

var wttwitch = {};

var beamSockets = {};
var beamIDs = {};
var beamChannelNames = {};

function saveChannelsJson()
{
	fs.rename("channels.json", "channels-bak-" + +new Date() + ".json", function() {
		fs.writeFile("channels.json", JSON.stringify(channels), "utf8", function() {});
	});
}

function closeBeamChat(channelName) {
	if(beamSockets[channelName]) {
		beamSockets[channelName].close();
		beamSockets[channelName] = null;
	}
}

function unlinkChannels(twitchChannel, beamChannel, channelIndex) {
	twitch.say(twitchChannel, "Chats unlinked.");
	sendBeamMessage(beamChannel, "Chat unlinked.");
	console.log(("Unlinked channels: " + beamChannel + " / " + twitchChannel).green);
	sendDebugBeamMessage("Unlinked channels: " + beamChannel + " / " + twitchChannel);
	
	channels.splice(channelIndex, 1);
	saveChannelsJson();

	closeBeamChat(beamChannel);
	twitch.part(twitchChannel);
}

function getChatLinkerInfo(site, channel) {
	var username = site === "twitch" ? "@Irti" : "@IrtiPlays";
	return "ChatLinker is a bot written by "+username+" that is linking the chats of this channel and "+site+" channel \""+channel.replace("#", "")+"\". Messages can be made more pretty in Chrome by using the ChatLinker Extension: \"http://bit.ly/2jE2gPM\".";
}

function onBeamMessage(channel, data) {
	var nick = data.user_name;
	var self = nick.toLowerCase() === accounts.beam.user.toLowerCase();

	if(self) return;

	var channelOwner = nick.toLowerCase() === channel.toLowerCase();
	var message = flattenBeamMessage(data.message.message);
	var beamIndex = chanIndex("beam", nick);
	
	if(message.slice(0, 6) == "!link ") {
		if(supportedAccounts.length > 0 && supportedAccounts.indexOf(nick.toLowerCase()) === -1) {
			return sendBeamWhisper(channel, nick, "You are not permitted to perform this action.");
		}
		
		var twitchUser = message.slice(6).toLowerCase();
		var twitchChannel = "#" + twitchUser;
		if(!wttwitch[twitchChannel]) {
			if(beamIndex == -1 && chanIndex("twitch", twitchChannel) == -1) {
				wttwitch[twitchChannel] = nick;
				sendBeamWhisper(channel, nick, "Watching " + twitchUser + "'s chat on Twitch. Confirmation instructions have been sent to " + twitchUser + ".");
				twitch.whisper(twitchUser, "I have been asked to link your Twitch chat with " + nick + "'s Beam chat. Whisper \"!link\" if you wish to confirm.");
				twitch.join(twitchChannel);
			} else {
				sendBeamWhisper(channel, nick, "One or both of your channels are already linked. Type \"!unlink\" on Beam or Twitch if you want to unlink them.");
			}
		}
		return;
	}

	if(message === '!unlink' && beamIndex !== -1)
	{
		var twitchChannel = channels[beamIndex].twitch;
		return unlinkChannels(twitchChannel, nick, beamIndex);
	}

	if(channel.toLowerCase() === accounts.beam.user.toLowerCase())
		return console.log(("    [beam#" + channel + "] " + nick + ": " + message).white);

	beamIndex = chanIndex("beam", channel);
	if(beamIndex == -1)
		return;

	var twitchChannel = channels[beamIndex].twitch;

	if (message === "!chatlinker") {
		return;

		/*var infoMessage = getChatLinkerInfo("twitch", twitchChannel);
		if(channelOwner) {
			return sendBeamMessage(channel, infoMessage);
		}
		else
		{
			return sendBeamWhisper(channel, nick, infoMessage);
		}*/
	}

	var displayName = (data.message.meta.me ? "/" : "") + nick;
	twitch.say(twitchChannel, "[" + displayName + "] " + message);
	console.log(("    [beam#" + channel + "] " + displayName + ": " + message).grey);
	sendDebugBeamMessage("[<beam#" + channel + "> " + displayName + "] " + message);
}

/**
 * Called when a beam socket emits "Close"
 * @param  {String} channelName The closed Channel
 */
function onSocketClose(channelName) {
	console.log(("Disconnected from Beam channel: " + channelName).yellow);
	var i = chanIndex("beam", channelName);
	//Check if we still actually care about this channel. We might catch "close"
	//events on a channel that has been !unliked.
	//We also check if this is the account we are running under aka "StreamLink_"
	//If this is the case we don't want to stop here
	if (i === -1 && channelName.toLowerCase() !== accounts.beam.user.toLowerCase()) {
		return;
	}
	var socket = beamSockets[channelName];

	//if we don't have a socket, just reconnect as though it was fresh channel
	if (!socket) {
		joinChannel(channelName);
		return;
	}

	//BeamSockets emit error and close events but will
	//automaticlaly try and reconnect on error but not on close.
	//If this is the case we'll see the connecting status here
	//As the socket is already reconnecting
	if (socket.status === BeamSocket.CONNECTING) {
		//Hey we are already reconnecting we don't need to do anything.
		//if we ever see CLOSED here it means everything else has given up
		return;
	}
	//This then re-spins up the websocket.
	socket.boot();
}

function onTwitchMessage(channel, userstate, message) {
	var nick = userstate.username
	var channelOwner = channel.toLowerCase() === "#" + nick;
	
	if (message === "!link" && channelOwner) {
		var beamChannel = wttwitch[channel];
		if (beamChannel) {
			return joinChannel(beamChannel).then(function() {
				sendBeamMessage(beamChannel, "Chats linked.");
				twitch.say(channel, "Chats linked.");
				console.log(("Linked channels: " + beamChannel + " / " + channel).green);
				sendDebugBeamMessage("Linked channels: " + beamChannel + " / " + channel);
				
				channels.push({beam: beamChannel, twitch: channel});
				saveChannelsJson();
				
				delete wttwitch[channel];
			});
		}
	}
	var twitchIndex = chanIndex("twitch", channel);
	if(twitchIndex == -1) return;

	var beamChannel = channels[twitchIndex].beam
	if (message === "!unlink" && channelOwner) {
		return unlinkChannels(channel, beamChannel, twitchIndex);
	}

	if (message === "!chatlinker") {
		return;
		/*var infoMessage = getChatLinkerInfo("Beam", beamChannel);
		if(channelOwner) {
			return twitch.say(channel, infoMessage);
		}
		else
		{
			return twitch.whisper(nick, infoMessage);
		}*/
	}

	var displayName = userstate["display-name"];
	if(userstate["message-type"] == "action") {
		displayName = "/"+displayName;
	}
	sendBeamMessage(beamChannel, "[" + displayName + "] " + message);
	console.log(("    [twitch" + channel + "] " + displayName + ": " + message).grey);
	sendDebugBeamMessage("[<twitch" + channel + "> " + displayName + "] " + message);
};

//To join a channel we need its id, then we need the ws address and an authkey.
//This handles them all
function joinChannel(channelName) {
	//we need the channel id.
	return beam.request('get', '/channels/' + channelName).bind(this)
	.then(function(response) {
		beamIDs[channelName] = response.body.id;
		beamChannelNames[response.body.id] = channelName;
		return beam.chat.join(response.body.id);
	}).then(function(response){
		beamSockets[channelName] = new BeamSocket(response.body.endpoints).boot();
		beamSockets[channelName].on('ChatMessage', onBeamMessage.bind(this, channelName));
		beamSockets[channelName].on('closed', onSocketClose.bind(this,channelName));

		return beamSockets[channelName]
		.call('auth', [beamIDs[channelName], accounts.beam.id, response.body.authkey])
		.then(function(){
			console.log(("Connected to Beam channel: " + channelName).cyan);
		}).catch(function(err){
			console.log(err);
			throw err;
		});
		//Move all in one to here
		
	}).catch(function(err) {
		throw err;
	});
}

//Connect and authenticate as a User on beam,
beam.use('password', {
	username: accounts.beam.user,
	password: accounts.beam.pass
}).attempt()
.then(function(response) {
	console.log(('Connected to beam').cyan);
	accounts.beam.id = response.body.id;
	joinChannel(accounts.beam.user);
	connectToChannels();
})
.catch(function(err){
	//throw err;
	if(err && err.message && err.message.body) {
		console.log(err.message.body);
		return;
	}
	console.log(err);
});

//Connect to twitch
twitch.connect();

// Functions for stuff.
function chanIndex(site, channel) {
	var toret = -1;
	for(var j = 0; j < channels.length; j++) {
		if(channels[j][site] == channel) {
			toret = j;
		}
	}
	return toret;
}

//We need to delay this until after beam is logged in
function connectToChannels() {
	// Connection logging and stuff.
	for(var i = 0; i < channels.length; i++) {
		console.log(("Trying to connect to channels: " + channels[i].beam + " / " + channels[i].twitch).white);
		//Do manually connect to beam though because it does require some extra lifting
		joinChannel(channels[i].beam);
	}
}

twitch.on("join", function (channel, username, self) {
	console.log(("Connected to Twitch channel: " + channel).magenta);
});

// Reconnect when disconnected
twitch.on("part", function(channel, username, self) {
	if(chanIndex("twitch", channel) > -1) {
		console.log(("Reconnect to twitch" + channel + "...").yellow);
		twitch.join(channel);
	}
});

function extractTextFromMessagePart(part) {
	if (part == undefined) {
		return '';
	}
	if (typeof part === "object") {
		if (part.type != null && part.type === 'text') {
			return part.data;
		}

		if(part.text != null) {
			return ' ' + part.text;
		}

		return '';
	}
	return part;
}

//Flatten a beam message down into a string
function flattenBeamMessage(message) {
	var result = '';
	if (message.length !== undefined) {
		if(message.length > 1 ) {
			result = message.reduce(function (previous, current) {
				if (!previous) {
					previous = '';
				}
				if (typeof previous === 'object') {
					previous = extractTextFromMessagePart(previous);
				}
				return previous + extractTextFromMessagePart(current);
			});
		} else if(message.length === 1) {
			result = extractTextFromMessagePart(message[0]);
		} else {
			return '';
		}
	} else {
		result = message;
	}
	return ent.decode(result);
}

//Beam.say is not longer valid, we need to find the correct socket and use that
function sendBeamMessage(channel, message) {
	var socket = beamSockets[channel];
	if(socket) {
		socket.call('msg',[message]);
	}
}

function sendBeamWhisper(channel, nick, message) {
	var socket = beamSockets[channel];
	if(socket) {
		socket.call('whisper',[nick, message]);
	}
}

function sendDebugBeamMessage(message) {
	if(debug) {
		sendBeamMessage(accounts.beam.user, message);
	}
}

twitch.on("message", function (channel, userstate, message, self) {
	if(self) return;

	switch(userstate["message-type"]) {
			case "action":
			case "chat":
			case "whisper":
					onTwitchMessage(channel, userstate, message);
					break;
	}
});
