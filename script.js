// Variables and requires and stuff.
var irc = require("irc");
var colors = require("colors");
var fs = require("fs");
var request = require("request");

var Beam = require('beam-client-node');
var BeamSocket = require('beam-client-node/lib/ws');
//Beam messages should be decoded for safety
var ent = require('ent');

var beam = new Beam();

var accounts = JSON.parse(fs.readFileSync("accounts.json", "utf8"));
var channels = JSON.parse(fs.readFileSync("channels.json", "utf8"));
var wttwitch = {};

var usernames = {
	beam: {},
	twitch: {}
};

var beamSockets = {};
var beamIDs = {};
var beamChannelNames = {};

function removeHash(channelName) {
	return channelName.replace('#','');
}

function closeBeamChat(channelName) {
	if(beamSockets[channelName]) {
		beamSockets[channelName].close();
		beamSockets[channelName] = null;
	}
}

function onBeamMessage(channelName,data) {
	var message = flattenBeamMessage(data.message.message);
	var nick = data.user_name;
	var beamIndex = chanIndex({prop: "beam", string: nick});
	var to = channelName;
	var text = message;
	if(message === '!unlink' && beamIndex > -1) {
		sendBeamMessage(nick, "Chats unlinked");
		twitch.say("#" + channels[beamIndex].twitch, "Chats unlinked.");

		console.log(("Unlinked channels: " + nick + " / " + channels[beamIndex].twitch).green);
		sendBeamMessage(accounts.beam.user, "Unlinked channels: " + nick + " / " + channels[beamIndex].twitch)

		disconnectChats({beam: nick, twitch: channels[beamIndex].twitch});

		channels.splice(beamIndex, 1);
		closeBeamChat(channelName);
		if(channels[channelName]) {
			twitch.part("#" + channels[beamIndex].twitch);
		}
		fs.writeFile("channels.json", JSON.stringify(channels), "utf8");
	}
	if(text.slice(0, 5) == "!link" && !wttwitch[text.slice(6).toLowerCase()]) {
		if(beamIndex == -1 && chanIndex({prop: "twitch", string: message.slice(6).toLowerCase()}) == -1) {
			getUsername({site: "beam", name: nick}, function(nick) {
				sendBeamMessage(accounts.beam.user, "@" + nick + ": Watching " + text.slice(6) + "'s chat on Twitch. Go to your channel and type \"!link\" to confirm.");
			});
			wttwitch[text.slice(6).toLowerCase()] = nick;
			twitch.join("#" + text.slice(6).toLowerCase());
			twitch.say("#" + text.slice(6).toLowerCase(), "I have been asked to link this Twitch chat with a Beam chat. If you requested this, type \"!link\".");
			twitch.removeAllListeners("message#" + text.slice(6).toLowerCase());

			twitch.on("message#" + text.slice(6).toLowerCase(), function(nick, text) {
				if(text == "!link" && wttwitch[nick]) {
					twitch.removeAllListeners("message#" + nick);
					connectChats({beam: wttwitch[nick], twitch: nick}).then(function(){
						sendBeamMessage(wttwitch[nick], "Chats Linked");
						twitch.say("#" + nick, "Chats linked.");
						console.log(("Linked channels: " + wttwitch[nick] + " / " + nick).green);
						sendBeamMessage(accounts.beam.user, "Linked channels: " + wttwitch[nick] + " / " + nick);
						channels.push({beam: wttwitch[nick], twitch: nick});
						fs.writeFile("channels.json", JSON.stringify(channels), "utf8");
						delete wttwitch[nick];
					});
				}
			});
		} else {
			getUsername({site: "beam", name: nick}, function(nick) {
				sendBeamMessage(accounts.beam.user, "@" + nick + ": One or both of your channels are already linked. Type \"!unlink\" on Beam or Twitch if you want to unlink them.");
			});
		}
	}
	if(nick != accounts.beam.user) {
		if(channelName == accounts.beam.user) {
			console.log(("    [beam" + channelName + "] " + nick + ": " + text).white);
		} else {
			console.log(("    [beam" + channelName + "] " + nick + ": " + text).grey);
			getUsername({site: "beam", name: nick}, function(nick) {
				sendBeamMessage(accounts.beam.user, "[<beam" + channelName + "> " + nick + "] " + text);
			});
		}
	} else {
		console.log(("    [beam] " + text).yellow);
	}
}
/**
 * Called when a beam socket emits "Close"
 * @param  {String} channelName The closed Channel
 */
function onSocketClose(channelName) {
	console.log(("Disconnected from Beam channel: " + channelName +" attemping to reconnect.").yellow);
	var i = chanIndex({prop: "beam", string: channelName});
	//Check if we still actually care about this channel. We might catch "close"
	//events on a channel that has been !unliked.
	//We also check if this is the account we are running under aka "StreamLink_"
	//If this is the case we don't want to stop here
	if (i === -1 && channelName.toLowerCase() !== accounts.beam.username.toLowerCase()) {
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

//To join a channel we need its id, then we need the ws address and an authkey.
//This handles them all
function joinChannel(channelName) {
	channelName = removeHash(channelName);
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
var twitch = new irc.Client("irc.twitch.tv", accounts.twitch.user, {
	port: 6667,
	userName: accounts.twitch.user.toLowerCase(),
	realName: accounts.twitch.user,
	password: accounts.twitch.pass,
	floodProtection: true,
	floodProtectionDelay: 1500,
	channels: (function() {
		var i = ["#" + accounts.twitch.user];
		for(var j = 0; j < channels.length; j++) {
			i.push("#" + channels[j].twitch);
		}
		return i;
	}())
});
//Prevent crashes, if there are no listeners to an "error" event it will crash
twitch.addListener("error", function(message) {
	console.log(("Twitch Error: ", message).red);
});

// Functions for stuff.
function chanIndex(i) {
	var toret = -1;
	for(var j = 0; j < channels.length; j++) {
		if(channels[j][i.prop] == i.string) {
			toret = j;
		}
	}
	return toret;
}

function getUsername(i, callback) {
	switch(i.site) {
		case "beam":
			// Beam sends us the username correctly capitalized etc
			// we don't need to hit their limits
			callback(i.name);
			break;
		case "twitch":
			if(usernames.twitch[i.name]) {
				callback(usernames.twitch[i.name]);
			} else {
				request("https://api.twitch.tv/kraken/users/" + i.name, function(error, response, body) {
					if(!error && response.statusCode == 200) {
						usernames.twitch[i.name] = JSON.parse(body).display_name;
						callback(JSON.parse(body).display_name);
					}
				});
			}
			break;
	}
}

function connectChats(i) {
	twitch.on("message#" + i.twitch.toLowerCase(), function(nick, text) {
		if(nick.toLowerCase() != accounts.twitch.user.toLowerCase()) {
			getUsername({site: "twitch", name: nick}, function(nick) { // HIS NAME IS NICK!
				sendBeamMessage(i.beam, "[" + nick + "] " + text);
			});
		}
	});
	return joinChannel(i.beam).then(function(){
		beamSockets[i.beam].on("ChatMessage", function(data){
			var nick = data.user_name;
			var text = flattenBeamMessage(data.message.message);
			if(nick.toLowerCase() != accounts.beam.user.toLowerCase()) {
				getUsername({site: "beam", name: nick}, function(nick) { // HIS NAME IS ALSO NICK!
					twitch.say("#" + i.twitch, "[" + nick + "] " + text);
				});
			}
		});
	});
}

function disconnectChats(i) {
	twitch.removeAllListeners("message#" + i.twitch);
	closeBeamChat(i.beam);
}

//We need to delay this until after beam is logged in
function connectToChannels() {
	// Connection logging and stuff.
	for(var i = 0; i < channels.length; i++) {
		console.log(("Trying to connect to channels: " + channels[i].beam + " / " + channels[i].twitch).white);
		//Don't call .join here, the connections array passed in the IRC constructor above will handle that
		twitch.once("join#" + channels[i].twitch, function(i) {
			console.log(("Connected to Twitch channel: " + channels[i].twitch).magenta);
		}.bind(this, i));
		//Do manually connect to beam though because it does require some extra lifting
		//TODO: Beam might have rate limits, If so delay the execution of this method
		//by x ms
		connectChats({beam: channels[i].beam, twitch: channels[i].twitch});
	}
}

// Reconnect when disconnected
twitch.on("part", function(channel, nick, reason, message) {
	if(chanIndex({prop: "twitch", string: channel.slice(1)}) > -1) {
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
function sendBeamMessage(channel,message) {
	var socket = beamSockets[channel];
	if(socket) {
		socket.call('msg',[message]);
	}
}

//We should probably combine these tooo!
//Unlink
twitch.on("message", function(nick, to, text) {
	var i = chanIndex({prop: "twitch", string: nick});
	if(text == "!unlink" && i > -1) {
		if(to != "#" + nick) {
			twitch.say(to, "Chats unlinked.");
		}
		twitch.say("#" + nick, "Chats unlinked.");
		sendBeamMessage(channels[i].beam, "Chats unlinked.");
		console.log(("Unlinked channels: " + channels[i].beam + " / " + nick).green);
		sendBeamMessage(accounts.twitch.user, "Unlinked channels: " + channels[i].beam + " / " + nick);

		disconnectChats({beam: channels[i].beam, twitch: nick});

		channels.splice(i, 1);
		twitch.part("#" + nick);
		if (channels[i]) {
			closeBeamChat(channels[i].beam);
		}
		fs.writeFile("channels.json", JSON.stringify(channels), "utf8");
	}
});

// Log chat messages.

twitch.on("message", function(nick, to, text) {
	if(to.slice(0, 1) == "#") {
		if(nick.toLowerCase() != accounts.twitch.user.toLowerCase()) {
			if(to == "#" + accounts.twitch.user) {
				console.log(("    [twitch" + to + "] " + nick + ": " + text).white);
			} else {
				console.log(("    [twitch" + to + "] " + nick + ": " + text).grey);
				getUsername({site: "twitch", name: nick}, function(nick) {
					sendBeamMessage(accounts.twitch.user, "[<twitch" + to + "> " + nick + "] " + text);
				});
			}
		}
	} else {
		console.log(("    [twitch] " + text).yellow);
	}
});
