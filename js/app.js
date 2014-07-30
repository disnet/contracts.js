// returns the log array
function cleanerEval(str, oldConsole) {
	var logArr = [];
    var console = {
        log: function(msg) {
		    logArr.push(msg);
            oldConsole.log(msg);
        }
    };
	eval(str);
	return logArr;
}

var examples = [
    {
        id: 1,
        file: "average-loc.js",
        title: "Average Lines of Code"
    },
    {
        id: 2,
        file: "higher-order.js",
        title: "Higher-Order"
    },
    {
        id: 3,
        file: "proxied-object.js",
        title: "Proxied Object"
    },
    {
        id: 4,
        file: "dependent.js",
        title: "Dependent Contracts"
    },
    {
        id: 4,
        file: "dependent-indy.js",
        title: "Dependent Contracts with Indy Blame"
    }
];
var contractModulePromise = Ember.$.ajax("macros/index.js", {
    dataType: "text"
});

var editor;
App = Ember.Application.create({});


App.Router.map(function() {
    this.route("about");
    this.resource("examples", { path: "/"}, function() {
        this.resource("example", {path: ":example_id"});
    });
});


App.ExamplesController = Ember.ObjectController.extend({
    errors: "",
    logs: [],
    run: false,
    currentTitle: "Examples",

    actions: {
        select: function(example) {
            Ember.$.ajax("examples/" + example.file, {
                dataType: "text"
            }).then(function(code) {
                editor.setValue(code);
            });
            this.set("currentTitle", example.title);
        },
        run: function() {
            contractModulePromise.then(function(moduleSrc) {
                this.set("errors", "");
                try {
                    var contractsModule = sweet.loadModule(moduleSrc, undefined, {
                        filename: "contracts.js"
                    });
                    var out = sweet.compile(editor.getValue(), {
                        readableNames: false,
                        modules: [contractsModule]
                    });
                    var logArr = cleanerEval(out.code, console.log);
                    this.set("run", true);
                    this.set("logs", logArr.map(function(l) {
                        return { l: l };
                    }));

                } catch (e) {
                    this.set("errors", e);
                }
            }.bind(this));
        }
    }
});

App.ExamplesRoute = Ember.Route.extend({
    model: function() {
        return examples;
    }

});

App.ExamplesView = Ember.View.extend({
    didInsertElement: function() {
        editor = CodeMirror.fromTextArea($("#editor")[0], {
	        mode: "javascript",
	        lineNumbers: true
        });
    }
});

App.ExampleRoute = Ember.Route.extend({
    model: function(params) {
        return examples.findBy("id", params.example_id);
    }
});
