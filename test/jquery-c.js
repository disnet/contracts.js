/*global jQuery: true, Contracts: true */

jQuery = (function() {
    var C = Contracts.C,
        K = Contracts.K,
        jqTopLevel = C.object({
            fn: C.object({}), // the prototype
            length : K.Number,
            isFunction : C.fun(C.any, K.Boolean),
            isArray: C.fun(C.any, K.Boolean),
            isWindow: C.fun(C.any, K.Boolean), // will fail since isWindows(null/undefined) -> null/undefined -- truthiness fail
            isNaN: C.fun(C.any, K.Boolean),
            isReady: K.Boolean,   // possibly some interesting dependent relation
            readyWait : K.Number, // between these ready functions
            ready: C.fun(C.any, C.any),
            bindReady : C.fun(C.any, C.any),
            holdReady: C.fun(K.Boolean, C.any),

            isPlainObject : C.fun(C.any, K.Boolean),
            // isPlainObject : C.fun(C.any, K.Boolean, {pre: function(obj) { obj.bar === 34 }}),
            isEmptyObject : C.fun(C.any, K.Boolean),
            // ([a] + {name:a...}) -> (a -> b) -> () -- more precise than I can get currently
            each : C.fun(C.or([K.Array, C.object({})]), C.fun(C.any,C.any), C.any),
            type: C.fun(C.any, K.String),
            error : C.fun(K.String, C.any),
            parseJSON : C.funD(C.or([K.String, K.Undefined, K.Null]), function(args) {
                var arg = args[0];  // only care about the first arg
                if(arg === undefined || arg === null || arg === "") {
                    return K.Null;
                } else {
                    return C.object({});
                }
            }),
            parseXML : C.fun(C.any, C.any),
            noop : C.fun(K.Undefined, C.Undefined),
            globalEval : C.fun(K.String, C.any),
            // nodeName : {nodeName : String} x String -> String, 
            nodeName : C.fun(C.object({ nodeName : K.String}), K.String, K.String),
            trim : C.fun(K.String, K.String), // causes jquery tests to fail since the trim function is liberal
            // breakes qunit's "same(makeArray({length: "0"}), [])" but it does create an empty
            // array...just not deepEqual I think
            makeArray : C.fun(C.any, K.Array),
            inArray : C.fun(C.any, K.Array, K.Number),
            merge : C.fun(K.Array, K.Array, K.Array), // sameness fail
            grep : C.fun(K.Array, C.fun(C.any, K.Number, K.Boolean), K.Boolean, K.Array),
            map : C.fun(C.or([K.Array, C.object({})]), C.fun(C.any, K.Number, C.any), K.Array),
            guid : K.Number,
            // proxy : C.fun([C.fun(C.any, C.any), C.object({})], C.fun(C.any, C.any)),
            proxy : C.fun(C.any, C.any),
            // no documentation on this method
            access : C.fun(C.any, C.any),
            uaMatch : C.fun(K.String, C.object({browser: K.String, version: K.String})),

            // {...} x {name1: val1 ...} x {nameN: valN} -> { /* props from first obj merged with 1..N */ }
            // also modifies first object
            extend: C.any,
            noConflict:  C.any,
            // also has browser dependent property (eg mozilla)
            browser : C.object({version: K.String}),

            // want to say Date
            now : C.any,

            sub : C.any
        }),
        jq = C.object({
            length: K.Number
        });

    jq.addPropertyContract({
        // addClass :: String -> jQuery
        addClass : C.fun(K.String, jq),
        selector : K.String,
        jquery : K.String,
        size : C.fun(C.any, K.Number),
        toArray : C.fun(C.any, K.Array), // sameness fail
        // Unit -> [els]
        // Number -> el
        get : C.fun(C.any, C.any), // sameness fail

        pushStack : C.any,
        each : C.any,
        ready : C.any,
        eq : C.any,
        first : C.any,
        last : C.any,
        slice : C.any,
        map : C.any,
        end : C.any,
        push : C.any,
        sort : C.any,
        splice : C.any,
        extend : C.any,
        data : C.any,
        removeData : C.any,
        queue : C.any,
        dequeue : C.any,
        delay : C.any,
        clearQueue : C.any,
        promise : C.any,
        attr : C.any,
        removeAttr : C.any,
        prop : C.any,
        removeProp : C.any,
        removeClass : C.any,
        toggleClass : C.any,
        hasClass : C.any,
        val : C.any,
        bind : C.any,
        one : C.any,
        unbind : C.any,
        delegate : C.any,
        undelegate : C.any,
        trigger : C.any,
        triggerHandler : C.any,
        toggle : C.any,
        hover : C.any,
        live : C.any,
        die : C.any,
        blur : C.any,
        focus : C.any,
        focusin : C.any,
        focusout : C.any,
        load : C.any,
        resize : C.any,
        scroll : C.any,
        unload : C.any,
        click : C.any,
        dblclick : C.any,
        mousedown : C.any,
        mouseup : C.any,
        mousemove : C.any,
        mouseover : C.any,
        mouseout : C.any,
        mouseenter : C.any,
        mouseleave : C.any,
        change : C.any,
        select : C.any,
        submit : C.any,
        keydown : C.any,
        keypress : C.any,
        keyup : C.any,
        error : C.any,
        find : C.any,
        has : C.any,
        not : C.any,
        filter : C.any,
        is : C.any,
        closest : C.any,
        index : C.any,
        add : C.any,
        andSelf : C.any,
        parent : C.any,
        parents : C.any,
        parentsUntil : C.any,
        next : C.any,
        prev : C.any,
        nextAll : C.any,
        prevAll : C.any,
        nextUntil : C.any,
        prevUntil : C.any,
        siblings : C.any,
        children : C.any,
        contents : C.any,
        text : C.any,
        wrapAll : C.any,
        wrapInner : C.any,
        wrap : C.any,
        unwrap : C.any,
        append : C.any,
        prepend : C.any,
        before : C.any,
        after : C.any,
        remove : C.any,
        empty : C.any,
        clone : C.any,
        html : C.any,
        replaceWith : C.any,
        detach : C.any,
        domManip : C.any,
        appendTo : C.any,
        prependTo : C.any,
        insertBefore : C.any,
        insertAfter : C.any,
        replaceAll : C.any,
        css : C.any,
        serialize : C.any,
        serializeArray : C.any,
        ajaxStart : C.any,
        ajaxStop : C.any,
        ajaxComplete : C.any,
        ajaxError : C.any,
        ajaxSuccess : C.any,
        ajaxSend : C.any,
        show : C.any,
        hide : C.any,
        _toggle : C.any,
        fadeTo : C.any,
        animate : C.any,
        stop : C.any,
        slideDown : C.any,
        slideUp : C.any,
        slideToggle : C.any,
        fadeIn : C.any,
        fadeOut : C.any,
        fadeToggle : C.any,
        offset : C.any,
        position : C.any,
        offsetParent : C.any,
        scrollLeft : C.any,
        scrollTop : C.any,
        innerHeight : C.any,
        outerHeight : C.any,
        height : C.any,
        innerWidth : C.any,
        outerWidth : C.any,
        width : C.any,
        constructor : C.any,
        init : C.any
        // prevObject : C.any,  // these two only are present on jquery objects that have returned elements
        // context : C.any,
    });

    return C.guard(
        C.and(
            jqTopLevel,
            C.fun(C.any, jq)
        ),
        jQuery,
        "server",
        "client");
})();

