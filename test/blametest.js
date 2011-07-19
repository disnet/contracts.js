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
    // function blame messages
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

    bt("or combinator, client is blamed", function() {
        var idc = guard(
            fun(or(Num, Str), Bool),
            function(ns) { return false; });
        idc(false);
    });

    bt("or combinator non first order value", function() {
        var idc = guard(
            or(fun(Num, Bool), Bool),
            function(ns) { return false; });
        idc(42);
    });

    bt("and combinator, client is blamed", function() {
        var idc = guard(
            fun(and(Num, Str), Bool),
            function(ns) { return false; });
        idc(false);
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

    bt("function new only, client at fault", function() {
        var idc = guard(
            fun(Str, object({}), {newOnly: true}),
            function(s) { });

        idc("foo");
    });

    bt("function call only, client at fault", function() {
        var idc = guard(
            fun(Str, Num, {callOnly: true}),
            function(s) { return 42; });
        new idc("foo");
    });

    bt("function this contract, client at fault", function() {
        var idc = guard(
            fun(Str, Num, {this: object({a: Num, b: Str})}),
            function(s) { return this.a; });
        var o = {a: "foo", b:"foo", f: idc};
        o.f("foo");
    });


    // object blame messages
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
    bt("object prop reaad-only but contract writable, server at fault", function() {
        var oo = Object.defineProperty({a: "foo"}, "b", {value: 42, writable: false});
        var o = guard(
            object({a: {value: Str, writable: true}, b: {value: Num, writable: true }}),
            oo);
        o.b = 22;
    });
    bt("object prop writable but contract read-only, server at fault", function() {
        var oo = Object.defineProperty({a: "foo"}, "b", {value: 42, writable: true});
        var o = guard(
            object({a: {value: Str, writable: true}, b: {value: Num, writable: false }}),
            oo);
        o.b = 22;
    });
    bt("object prop enumerable but contract non-enumerable, server at fault", function() {
        var oo = Object.defineProperty({a: "foo"}, "b", {value: 42, enumerable: true});
        var o = guard(
            object({a: {value: Str, writable: true}, b: {value: Num, enumerable: false }}),
            oo);
    });
    bt("object prop configurable but contract non-configurable, server at fault", function() {
        var oo = Object.defineProperty({a: "foo"}, "b", {value: 42, configurable: true});
        var o = guard(
            object({a: {value: Str, writable: true}, b: {value: Num, configurable: false }}),
            oo);
    });
    bt("object prop no-write, client at fault", function() {
        var oo = Object.defineProperty({a: "foo"}, "b", {value: 42, writable: false});
        var o = guard(
            object({a: {value: Str, writable: true}, b: {value: Num, writable: false }}),
            oo);
        o.b = 22;
    });
    bt("object prop non-configurable, client at fault", function() {
        var oo = Object.defineProperty({a: "foo"}, "b", {value: 42, configurable: false});
        var o = guard(
            object({a: {value: Str, writable: true}, b: {value: Num, writable: false }}),
            oo);
        Object.defineProperty(o, "b", {value: "bar", configurable: true});
    });

    bt("object with function pre-condition, client at fault", function() {
        var o = guard(
            object({
                f: fun(Num, Num, {
                    pre: function(obj) { return obj.a > 0; }}),
                a: Num
            }), {
                a: -1,
                f: function(n) {
                    return this.a + n;
                }
            });
        o.f(42);
    });

    bt("object with function post-condition, client at fault", function() {
        var o = guard(
            object({
                f: fun(Num, Num, {
                    post: function(obj) { return obj.a > 0; }}),
                a: Num
            }), {
                a: -1,
                f: function(n) {
                    return this.a + n;
                }
            });
        o.f(42);
    });

    bt("object with function 'this' contract, client at fault", function() {
        var o = guard(
            object({
                a: Num,
                f: fun(Num, Str, {
                    this: object({a: Num})})
            }), {
                a: 24,
                f: function(n) {
                    return this.a;
                }
            });
        var f = o.f;
        f(42);
    });
    bt("object with function 'this' contract, server at fault", function() {
        var o = guard(
            object({
                a: Str,
                f: fun(Num, Str, {
                    this: object({a: Num})})
            }), {
                a: 24,
                f: function(n) {
                    return this.a;
                }
            });
        o.f(42);
    });

    bt("object with function 'this' contract, client at fault but in 'construction' of contract", function() {
        // odd but correct behavior to blame the client...the client should have put f on a different
        // object since the this contract doesn't match the object that the function is in.
        var o = guard(
            object({
                a: Num,
                f: fun(Num, Str, {
                    this: object({a: Str})})
            }), {
                a: 24,
                f: function(n) {
                    return this.a;
                }
            });
        o.f(42);
    });
});
