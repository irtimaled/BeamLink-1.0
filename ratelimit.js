exports.Bin = function(many, ton) {
	this.list = [];
	
	setInterval(function() {
		if(this.list.length > 0) {
			this.list[0]();
			this.list.splice(0, 1);
		}
	}.bind(this), (1000 * ton) / many);
};
