// Variables and requires and stuff.
var irc = require("irc");
var colors = require("colors");
var fs = require("fs");
var accounts = JSON.parse(fs.readFileSync("accounts.json", "utf8"));
var channels = JSON.parse(fs.readFileSync("channels.json", "utf8"));
var wttwitch = {};
// var wtbeam = {};

// Connections to Beam and Twitch.
var beam = new irc.Client("benbaptist.com", accounts.beam.user, {
	// debug: true,
	port: 40005,
	userName: "beamlink",
	realName: "BeamLink",
	password: accounts.beam.pass,
	
	channels: (function() {
		var i = ["#beamlink"];
		for(var j = 0; j < channels.length; j++) {
			i.push("#" + channels[j].beam);
		}
		return i;
	}())
});
var twitch = new irc.Client("irc.twitch.tv", accounts.twitch.user, {
	// debug: true,
	port: 6667,
	userName: "beamlink",
	realName: "BeamLink",
	password: accounts.twitch.pass,
	floodProtection: true,
	floodProtectionDelay: 1500,
	
	channels: (function() {
		var i = ["#beamlink"];
		for(var j = 0; j < channels.length; j++) {
			i.push("#" + channels[j].twitch);
		}
		return i;
	}())
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
function connectChats(i) {
	twitch.on("message#" + i.twitch, function(nick, text) {
		if(nick != "beamlink") {
			beam.say("#" + i.beam, "[" + nick + "] " + text);
		}
	});
	beam.on("message#" + i.beam, function(nick, text) {
		if(nick != "beamlink") {
			twitch.say("#" + i.twitch, "[" + nick + "] " + text);
		}
	});
}
function disconnectChats(i) {
	twitch.removeAllListeners("message#" + i.twitch);
	beam.removeAllListeners("message#" + i.beam);
}

// Connection logging and stuff.
for(var i = 0; i < channels.length; i++) {
	console.log(("Trying to connect to channels: " + channels[i].beam + " / " + channels[i].twitch).white);
	beam.once("join#" + channels[i].beam, function(i) {
		// beam.say("#" + channels[i].beam, "BeamLink 1.0.1 connected. - Fixed BeamLink not leaving the chat after unlinking.");
		console.log(("Connected to Beam channel: " + channels[i].beam).cyan);
	}.bind(this, i));
	twitch.once("join#" + channels[i].twitch, function(i) {
		// twitch.say("#" + channels[i].twitch, "BeamLink 1.0.1 connected. - Fixed BeamLink not leaving the chat after unlinking.");
		console.log(("Connected to Twitch channel: " + channels[i].twitch).magenta);
	}.bind(this, i));
	
	connectChats({beam: channels[i].beam, twitch: channels[i].twitch});
}

// Unlink chats with command.
beam.on("message", function(nick, to, text) {
	var i = chanIndex({prop: "beam", string: nick.toLowerCase()});
	if(text == "!unlink" && i > -1) {
		beam.part("#" + nick.toLowerCase());
		twitch.part("#" + channels[i].twitch);
		
		beam.say(to, "Chats unlinked.");
		beam.say("#" + nick.toLowerCase(), "Chats unlinked.");
		twitch.say("#" + channels[i].twitch, "Chats unlinked.");
		console.log(("Unlinked channels: " + nick.toLowerCase() + " / " + channels[i].twitch).green);
		beam.say("#beamlink", "Unlinked channels: " + nick.toLowerCase() + " / " + channels[i].twitch);
		
		disconnectChats({beam: nick.toLowerCase(), twitch: channels[i].twitch});
		channels.splice(i, 1);
		fs.writeFile("channels.json", JSON.stringify(channels), "utf8");
	}
});
twitch.on("message", function(nick, to, text) {
	var i = chanIndex({prop: "twitch", string: nick.toLowerCase()});
	if(text == "!unlink" && i > -1) {
		twitch.part("#" + nick.toLowerCase());
		beam.part("#" + channels[i].beam);
		
		twitch.say(to, "Chats unlinked.");
		twitch.say("#" + nick.toLowerCase(), "Chats unlinked.");
		beam.say("#" + channels[i].beam, "Chats unlinked.");
		console.log(("Unlinked channels: " + channels[i].beam + " / " + nick.toLowerCase()).green);
		beam.say("#beamlink", "Unlinked channels: " + channels[i].beam + " / " + nick.toLowerCase());
		
		disconnectChats({beam: channels[i].beam, twitch: nick.toLowerCase()});
		channels.splice(i, 1);
		fs.writeFile("channels.json", JSON.stringify(channels), "utf8");
	}
});

// Link chats with command.
beam.on("message#beamlink", function(nick, text) {
	if(text.slice(0, 5) == "!link" && !wttwitch[text.slice(6).toLowerCase()]) {
		if(chanIndex({prop: "beam", string: nick.toLowerCase()}) == -1 && chanIndex({prop: "twitch", string: text.slice(6).toLowerCase()}) == -1) {
			beam.say("#beamlink", "@" + nick + ": Watching " + text.slice(6) + "'s chat on Twitch. Go to your channel and type \"!link\" to confirm.");
			wttwitch[text.slice(6).toLowerCase()] = nick.toLowerCase();
			twitch.join("#" + text.slice(6).toLowerCase());
			twitch.say("#" + text.slice(6).toLowerCase(), "I have been asked to link this Twitch chat with a Beam chat. If you requested this, type \"!link\".");
			twitch.removeAllListeners("message#" + text.slice(6).toLowerCase());
			
			twitch.on("message#" + text.slice(6).toLowerCase(), function(nick, text) {
				if(text == "!link" && wttwitch[nick.toLowerCase()]) {
					twitch.removeAllListeners("message#" + nick.toLowerCase());
					beam.join("#" + wttwitch[nick.toLowerCase()], function(nick) {
						beam.say("#" + wttwitch[nick.toLowerCase()], "Chats linked.");
						twitch.say("#" + nick.toLowerCase(), "Chats linked.");
						console.log(("Linked channels: " + wttwitch[nick.toLowerCase()] + " / " + nick.toLowerCase()).green);
						beam.say("#beamlink", "Linked channels: " + wttwitch[nick.toLowerCase()] + " / " + nick.toLowerCase());
						
						connectChats({beam: wttwitch[nick.toLowerCase()], twitch: nick.toLowerCase()});
						channels.push({beam: wttwitch[nick.toLowerCase()], twitch: nick.toLowerCase()});
						fs.writeFile("channels.json", JSON.stringify(channels), "utf8");
						delete wttwitch[nick.toLowerCase()];
					}.bind(this, nick));
				}
			});
		} else {
			beam.say("#beamlink", "@" + nick + ": One or both of your channels are already linked. Type \"!unlink\" on Beam or Twitch if you want to unlink them.");
		}
	}
});

// Log chat messages.
beam.on("message", function(nick, to, text) {
	if(to.slice(0, 1) == "#") {
		if(nick != "beamlink") {
			if(to == "#beamlink") {
				console.log(("  [beam" + to + "] " + nick + ": " + text).white);
			} else {
				console.log(("    [beam" + to + "] " + nick + ": " + text).grey);
				beam.say("#beamlink", "[beam" + to + "] " + nick + ": " + text);
			}
		}
	} else {
		console.log(("[beam] " + text).yellow);
	}
});
twitch.on("message", function(nick, to, text) {
	if(to.slice(0, 1) == "#") {
		if(nick != "beamlink") {
			if(to == "#beamlink") {
				console.log(("  [twitch" + to + "] " + nick + ": " + text).white);
			} else {
				console.log(("    [twitch" + to + "] " + nick + ": " + text).grey);
				beam.say("#beamlink", "[twitch" + to + "] " + nick + ": " + text);
			}
		}
	} else {
		console.log(("[twitch] " + text).yellow);
	}
});
