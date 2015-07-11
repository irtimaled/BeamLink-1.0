// Variables and requires and stuff.
var irc = require("irc");
var colors = require("colors");
var fs = require("fs");
var request = require("request");

var accounts = JSON.parse(fs.readFileSync("accounts.json", "utf8"));
var channels = JSON.parse(fs.readFileSync("channels.json", "utf8"));
var wttwitch = {};
var usernames = {
	beam: {},
	twitch: {}
};

// Connections to Beam and Twitch.
var beam = new irc.Client("benbaptist.com", accounts.beam.user, {
	port: 40005,
	userName: "beamlink",
	realName: "BeamLink",
	password: accounts.beam.pass,
	
	channels: (function() {
		var i = ["#" + accounts.beam.user];
		for(var j = 0; j < channels.length; j++) {
			i.push("#" + channels[j].beam);
		}
		return i;
	}())
});
var twitch = new irc.Client("irc.twitch.tv", accounts.twitch.user, {
	port: 6667,
	userName: "beamlink",
	realName: "BeamLink",
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
			if(usernames.beam[i.name]) {
				callback(usernames.beam[i.name]);
			} else {
				request("https://beam.pro/api/v1/users/search?query=" + i.name, function(error, response, body) {
					if(!error && response.statusCode == 200) {
						usernames.beam[i.name] = JSON.parse(body)[0].username;
						callback(JSON.parse(body)[0].username);
					}
				});
			}
			
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
	twitch.on("message#" + i.twitch, function(nick, text) {
		if(nick != accounts.twitch.user) {
			getUsername({site: "twitch", name: nick}, function(nick) { // HIS NAME IS NICK!
				beam.say("#" + i.beam, "[" + nick + "] " + text);
			});
		}
	});
	beam.on("message#" + i.beam, function(nick, text) {
		if(nick != accounts.beam.user) {
			getUsername({site: "beam", name: nick}, function(nick) { // HIS NAME IS ALSO NICK!
				twitch.say("#" + i.twitch, "[" + nick + "] " + text);
			});
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
		console.log(("Connected to Beam channel: " + channels[i].beam).cyan);
	}.bind(this, i));
	twitch.once("join#" + channels[i].twitch, function(i) {
		console.log(("Connected to Twitch channel: " + channels[i].twitch).magenta);
	}.bind(this, i));
	
	connectChats({beam: channels[i].beam, twitch: channels[i].twitch});
}

// Reconnect when disconnected.
beam.on("part", function(channel, nick, reason, message) {
	if(chanIndex({prop: "beam", string: channel.slice(1)}) > -1) {
		console.log(("Reconnect to beam" + channel + "...").yellow);
		
		beam.join(channel);
	}
});
twitch.on("part", function(channel, nick, reason, message) {
	if(chanIndex({prop: "twitch", string: channel.slice(1)}) > -1) {
		console.log(("Reconnect to twitch" + channel + "...").yellow);
		
		twitch.join(channel);
	}
});

// Unlink chats with command.
beam.on("message", function(nick, to, text) {
	var i = chanIndex({prop: "beam", string: nick});
	if(text == "!unlink" && i > -1) {
		if(to != "#" + nick) {
			beam.say(to, "Chats unlinked.");
		}
		beam.say("#" + nick, "Chats unlinked.");
		twitch.say("#" + channels[i].twitch, "Chats unlinked.");
		console.log(("Unlinked channels: " + nick + " / " + channels[i].twitch).green);
		beam.say("#" + accounts.beam.user, "Unlinked channels: " + nick + " / " + channels[i].twitch);
		
		disconnectChats({beam: nick, twitch: channels[i].twitch});
		
		channels.splice(i, 1);
		beam.part("#" + nick);
		twitch.part("#" + channels[i].twitch);
		fs.writeFile("channels.json", JSON.stringify(channels), "utf8");
	}
});
twitch.on("message", function(nick, to, text) {
	var i = chanIndex({prop: "twitch", string: nick});
	if(text == "!unlink" && i > -1) {
		if(to != "#" + nick) {
			twitch.say(to, "Chats unlinked.");
		}
		twitch.say("#" + nick, "Chats unlinked.");
		beam.say("#" + channels[i].beam, "Chats unlinked.");
		console.log(("Unlinked channels: " + channels[i].beam + " / " + nick).green);
		beam.say("#" + accounts.twitch.user, "Unlinked channels: " + channels[i].beam + " / " + nick);
		
		disconnectChats({beam: channels[i].beam, twitch: nick});
		
		channels.splice(i, 1);
		twitch.part("#" + nick);
		beam.part("#" + channels[i].beam);
		fs.writeFile("channels.json", JSON.stringify(channels), "utf8");
	}
});

// Link chats with command.
beam.on("message#" + accounts.beam.user, function(nick, text) {
	if(text.slice(0, 5) == "!link" && !wttwitch[text.slice(6).toLowerCase()]) {
		if(chanIndex({prop: "beam", string: nick}) == -1 && chanIndex({prop: "twitch", string: text.slice(6).toLowerCase()}) == -1) {
			getUsername({site: "beam", name: nick}, function(nick) {
				beam.say("#" + accounts.beam.user, "@" + nick + ": Watching " + text.slice(6) + "'s chat on Twitch. Go to your channel and type \"!link\" to confirm.");
			});
			wttwitch[text.slice(6).toLowerCase()] = nick;
			twitch.join("#" + text.slice(6).toLowerCase());
			twitch.say("#" + text.slice(6).toLowerCase(), "I have been asked to link this Twitch chat with a Beam chat. If you requested this, type \"!link\".");
			twitch.removeAllListeners("message#" + text.slice(6).toLowerCase());
			
			twitch.on("message#" + text.slice(6).toLowerCase(), function(nick, text) {
				if(text == "!link" && wttwitch[nick]) {
					twitch.removeAllListeners("message#" + nick);
					beam.join("#" + wttwitch[nick], function(nick) {
						beam.say("#" + wttwitch[nick], "Chats linked.");
						twitch.say("#" + nick, "Chats linked.");
						console.log(("Linked channels: " + wttwitch[nick] + " / " + nick).green);
						beam.say("#" + accounts.beam.user, "Linked channels: " + wttwitch[nick] + " / " + nick);
						
						connectChats({beam: wttwitch[nick], twitch: nick});
						channels.push({beam: wttwitch[nick], twitch: nick});
						fs.writeFile("channels.json", JSON.stringify(channels), "utf8");
						delete wttwitch[nick];
					}.bind(this, nick));
				}
			});
		} else {
			getUsername({site: "beam", name: nick}, function(nick) {
				beam.say("#" + accounts.beam.user, "@" + nick + ": One or both of your channels are already linked. Type \"!unlink\" on Beam or Twitch if you want to unlink them.");
			});
		}
	}
});

// Log chat messages.
beam.on("message", function(nick, to, text) {
	if(to.slice(0, 1) == "#") {
		if(nick != accounts.beam.user) {
			if(to == "#" + accounts.beam.user) {
				console.log(("  [beam" + to + "] " + nick + ": " + text).white);
			} else {
				console.log(("    [beam" + to + "] " + nick + ": " + text).grey);
				
				getUsername({site: "beam", name: nick}, function(nick) {
					beam.say("#" + accounts.beam.user, "[<beam" + to + "> " + nick + "] " + text);
				});
			}
		}
	} else {
		console.log(("[beam] " + text).yellow);
	}
});
twitch.on("message", function(nick, to, text) {
	if(to.slice(0, 1) == "#") {
		if(nick != accounts.twitch.user) {
			if(to == "#" + accounts.twitch.user) {
				console.log(("  [twitch" + to + "] " + nick + ": " + text).white);
			} else {
				console.log(("    [twitch" + to + "] " + nick + ": " + text).grey);
				
				getUsername({site: "twitch", name: nick}, function(nick) {
					beam.say("#" + accounts.twitch.user, "[<twitch" + to + "> " + nick + "] " + text);
				});
			}
		}
	} else {
		console.log(("[twitch] " + text).yellow);
	}
});
