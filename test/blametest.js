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
});
