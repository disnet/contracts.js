(function() {
    if (typeof require === "function") {
        // importing patches Proxy to be in line with the new direct proxies
        require("harmony-reflect");
    }

    function assert(cond, msg) {
        if(!cond) {
            throw new Error(msg);
        }
    }

    var unproxy = new WeakMap();

    class Contract {
        constructor(name, type, handler) {
            this.name = name;
            this.type = type;
            this.handler = handler;
            this.parent = null;
        }

        check(val, pos, neg, parents) {
            return this.handler.call(this, val, pos, neg, parents ? parents : []);
        }
        toString() {
            return this.name;
        }
    }

    function blame(toblame, other, contract, value, parents) {
        var promisedContract;
        var msg = toblame + ": broke its contract\n" +
            "promised: " + contract + "\n" +
            "produced: " + value + "\n" +
            "which is not: " + contract + "\n" +
            "in: " + other + "\n" +
            "blaming: " + toblame;
        var e = new Error(msg);
        throw e;
    }


    function blameRng(violatedContract, funContract, pos, neg, value, parents) {
        var valueStr = typeof value === "string" ? "'" + value + "'" : value;

        var msg = pos + ": broke its contract\n" +
            "promised: " + violatedContract + "\n" +
            "produced: " + valueStr + "\n" +
            "in the range of:\n" + funContract + "\n" +
            "contract from: " + pos + "\n" +
            "blaming: " + pos;
        var e = new Error(msg);
        e.pos = pos;
        e.neg = neg;
        throw e;
    }

    function blameDom(violatedContract, funContract, pos, neg, value, position, parents) {
        var positionStr = position === 1 ? "1st" :
                          position === 2 ? "2nd" :
                          position === 3 ? "3rd" : position + "th";

        var valueStr = typeof value === "string" ? "'" + value + "'" : value;

        var msg = neg + ": contract violation\n" +
            "expected: " + violatedContract + "\n" +
            "given: " + valueStr + "\n" +
            "in the " + positionStr + " argument of:\n" + funContract + "\n" +
            "contract from: " + neg + "\n" +
            "blaming: " + pos;
        var e = new Error(msg);
        e.pos = pos;
        e.neg = neg;
        throw e;

    }

    function check(predicate, name) {
        var c = new Contract(name, "check", function(val, pos, neg, parents) {
            if (predicate(val)) {
                return val;
            } else {
                return blame(pos, neg, this, val, parents);
            }
        });
        return c;
    }


    return {
        Num: check(function(val) { return typeof val === "number"; }, "Num"),

        fun: function(dom, rng, options) {

            var domName = "(" + dom.join(",") + ")";
            var contractName = domName + " -> " + rng;

            var c = new Contract(contractName, "fun", function(f, pos, neg, parents) {

                if (typeof f !== "function") {
                    blame(pos, neg, this, f, parents);
                }

                parents.push(this);
                /* options:
                   pre: ({} -> Bool) - function to check preconditions
                   post: ({} -> Bool) - function to check postconditions
                   this: {...} - object contract to check 'this'
                */
                function applyTrap(target, thisVal, args) {

                    var checkedArgs = [];

                    for (var i = 0; i < args.length; i++) {
                        if (dom[i]) {
                            try {
                                checkedArgs.push(dom[i].check(args[i], neg, pos, parents));
                            } catch (b) {
                                blameDom(dom[i], contractName, neg, pos, args[i], i+1, parents);
                            }
                        }
                        checkedArgs.push(args[i]);
                    }

                    assert(rng instanceof Contract, "The range is not a contract");

                    var result;
                    var rawResult = target.apply(thisVal, checkedArgs);
                    try {
                        result = rng.check(rawResult, pos, neg, parents);
                    } catch (b) {
                        blameRng(rng, contractName, pos, neg, rawResult, parents);
                    }

                    return result;
                }


                p = new Proxy(f, {
                    apply: applyTrap
                });

                unproxy.set(p, this);
                return p;
            });

            return c;
        }
    };
})();
