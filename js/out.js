// returns the log array
function cleanerEval$624(str$629, oldConsole$630) {
    var logArr$631 = [];
    var console$632 = {
            log: function (msg$633) {
                logArr$631.push(msg$633);
                oldConsole$630.log(msg$633);
            }
        };
    eval(str$629);
    return logArr$631;
}
var examples$625 = [
        {
            id: 1,
            file: 'complex.js',
            title: 'Complex Numbers'
        },
        {
            id: 2,
            file: 'taint.js',
            title: 'Tainting'
        },
        {
            id: 3,
            file: 'units.js',
            title: 'Units of measure'
        }
    ];
var editor$626, compiled$627;
var vvalues$628 = returnExports;
App = Ember.Application.create({});
App.Router.map(function () {
    this.route('about');
    this.resource('examples', { path: '/' }, function () {
        this.resource('example', { path: ':example_id' });
    });
});
App.ExamplesController = Ember.ObjectController.extend({
    errors: '',
    logs: [],
    run: false,
    currentTitle: 'Examples',
    actions: {
        select: function (example$634) {
            Ember.$.ajax('examples/' + example$634.file, { dataType: 'text' }).then(function (code$635) {
                editor$626.setValue(code$635);
            });
            this.set('currentTitle', example$634.title);
        },
        run: function () {
            this.set('errors', '');
            try {
                var out$636 = vvalues$628.compile(editor$626.getValue(), { readableNames: true });
                compiled$627.setValue(out$636);
                var logArr$637 = cleanerEval$624(out$636, console);
                this.set('run', true);
                this.set('logs', logArr$637.map(function (l$638) {
                    return { l: l$638 };
                }));
            } catch (e$639) {
                this.set('errors', e$639);
            }
        }
    }
});
App.ExamplesRoute = Ember.Route.extend({
    model: function () {
        return examples$625;
    }
});
App.ExamplesView = Ember.View.extend({
    didInsertElement: function () {
        editor$626 = CodeMirror.fromTextArea($('#editor')[0], {
            mode: 'javascript',
            lineNumbers: true
        });
        compiled$627 = CodeMirror.fromTextArea($('#compiled')[0], {
            mode: 'javascript',
            lineNumbers: true,
            readOnly: true
        });
    }
});
App.ExampleRoute = Ember.Route.extend({
    model: function (params$640) {
        return examples$625.findBy('id', params$640.example_id);
    }
});