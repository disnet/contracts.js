function load(obj) {
    var name;
    for(name in obj) {
        if(obj.hasOwnProperty(name)) {
            window[name] = obj[name];
        }
    }
}
load(Contracts.combinators);
load(Contracts.contracts);

function bt(msg, f) {
    var $t = $("body").append("<div class='test'></div>");
    $t.append("<h3>" + msg + "</h3>");
    $t.append("<pre class='source'>" + f.toString() + "</pre>");
    try {
        f();
    } catch (err) {
        $t.append("<pre class='blame'>" + err.toString().replace(/\</, "&lt;").replace(/\>/, "&gt;") + "</pre>");
    }
}

$(document).ready(function() {
    bt("simple, client is blamed", function() {
        function id(x) {
            return x;
        }
        var idc = guard(
            fun(Num, Num),
            id);
        idc("foo");
    });
    bt("simple, server is blamed", function() {
        function id(x) {
            return "foo";
        }
        var idc = guard(
            fun(Num, Num),
            id);
        idc(42);
    });

    bt("multi args", function() {
        function id(x, y) {
            return x;
        }
        var idc = guard(
            fun([Num, Str], Num),
            id);
        idc("foo");
    });

    bt("higher order, server at fault", function() {
        function id(f) {
            f("foo");
            return "foo";
        }
        var idc = guard(
            fun(fun(Str, Str), Num),
            id);

        (function traceTest() {
            idc(function(x) { return x; });
        })();
    });

    bt("higher order, client at fault", function() {
        function id(f) {
            f("foo");
            return 42;
        }
        var idc = guard(
            fun(fun(Str, Str), Num),
            id);

        idc(function(x) { return 42; });
    });

    bt("higher order, client at fault, not a function", function() {
        function id(f) {
            f("foo");
            return 42;
        }
        var idc = guard(
            fun(fun(Str, Str), Num),
            id);

        idc(42);
    });
    bt("object, server at fault, not an object", function() {
        var o = guard(
            object({ a: Num }),
            42);
    });
    bt("object, server at fault", function() {
        var o = guard(
            object({ a: Num }),
            { a: "foo"});
        o.a;
    });
    bt("object missing properties, server at fault", function() {
        var o = guard(
            object({a: Num, b: Str}),
            {a: 42});
    });
    bt("object set, client at fault", function() {
        var o = guard(
            object({ a: Num }),
            { a: 42});
        o.a = "foo";
    });
    bt("object with a function, client at fault", function() {
        var o = guard(
            object({ f: fun(Num, Str)}),
            { f: function(n) { return "foo"; } });
        o.f("foo");
    });
    bt("object with a function, server at fault", function() {
        var o = guard(
            object({ f: fun(Num, Str)}),
            { f: function(n) { return 42; } });
        o.f(42);
    });
    bt("object, server at fault, not extensible", function() {
        var o = guard(
            object({ a: Num }, {extensible: false}),
            {a: 42});
    });
    bt("object with a function returning an object, server at fault", function() {
        var o = guard(
            object({ f: fun(Num, object({a: Num}))}),
            { f: function(n) { return {a: "foo"}; } });
        o.f(42).a;
    });
    bt("object with a function taking an object, client at fault", function() {
        var o = guard(
            object({ f: fun(object({a: Num}), Num)}),
            { f: function(o) { return o.a; } });
        o.f({a: "foo"});
    });
    bt("object non-extensible, client at fault", function() {
        var oo = { a: "foo"};
        Object.preventExtensions(oo);
        var o = guard(
            object({a: Str}, {extensible: false}),
            oo);
        Object.defineProperty(o, "foo", {value: 42});
    });
    bt("object sealed, client at fault", function() {
        var oo = { a: "foo"};
        Object.seal(oo);
        var o = guard(
            object({a: Str}, {sealed: true}),
            oo);
        delete o.a;
    });
    bt("object non-extensible call to set, client at fault", function() {
        var oo = { a: "foo"};
        Object.preventExtensions(oo);
        var o = guard(
            object({a: Str}, {extensible: false}),
            oo);
        o.bar = "bar";
    });
    bt("object frozen call to set, client at fault", function() {
        var oo = { a: "foo"};
        Object.freeze(oo);
        var o = guard(
            object({a: Str}, {frozen: true}),
            oo);
        o.a = "bar";
    });
});
