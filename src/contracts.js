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
            return this.handler(val, pos, neg, parents ? parents : []);
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
        e.toblame = toblame;
        // other properties on the error object to aid in testing
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
        Num: check(function(val) { return typeof val === "number"; }),

        fun: function(dom, rng, options) {

            var domName = "(" + dom.join(",") + ")";
            var contractName = domName + " -> " + rng.name;

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

                    var checkedArgs = args.map(function(arg, i) {
                        return dom[i] ? dom[i].check(arg, neg, pos, parents) : arg;
                    });

                    assert(rng instanceof Contract, "The range is not a contract");

                    return rng.check(target.apply(thisVal, checkedArgs), pos, neg, parents);
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
