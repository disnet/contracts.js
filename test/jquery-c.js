/*global jQuery: true, Contracts: true */

jQuery = (function() {
    var C = Contracts.C,
        K = Contracts.K,
        jqTopLevel = C.object({
            fn: C.object({}), // the prototype
            length : K.Number,
            extend: C.any,
            noConflict:  C.any,
            isReady: K.Boolean,   // possibly some interesting dependent relation
            readyWait : K.Number, // between these four
            holdReady: C.any,
            ready: C.any,
            bindReady : C.any,
            isFunction : C.fun(C.any, K.Boolean),
            isArray: C.fun(C.any, K.Boolean),
            isWindow: C.any, // C.fun(C.any, K.Boolean), can't do this since can return undefined
            isNaN: C.fun(C.any, K.Boolean),
            type: C.any,
            isPlainObject : C.fun(C.any, K.Boolean),
            isEmptyObject : C.fun(C.any, K.Boolean),
            error : C.any,
            parseJSON : C.any,
            parseXML : C.any,
            noop : C.any,
            globalEval : C.any,
            nodeName : C.any,
            // ([a] + {name:a...}) -> (a -> b) -> ([b] + {name:b...})
            each : C.fun(C.any, C.fun(C.any,C.any), C.any),
            trim : C.any,
            makeArray : C.any,
            inArray : C.any,
            merge : C.any,
            grep : C.any,
            map : C.any,
            guid : K.Number,
            proxy : C.any,
            access : C.any,
            now : C.any,
            uaMatch : C.any,
            sub : C.any,
            browser : C.any
        }),
        jq = C.object({
            length: K.Number
        });

    jq.addPropertyContract({
        // addClass :: String -> jQuery
        addClass : C.fun(K.String, jq)
    })

    return C.guard(
        C.and(
            jqTopLevel,
            C.fun(C.any, jq)
        ),
        jQuery,
        "server",
        "client");
})();
