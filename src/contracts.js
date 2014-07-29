(function() {
    "use strict";
    if (typeof require === "function") {
        // importing patches Proxy to be in line with the new direct proxies
        require("harmony-reflect");
    }

    var Blame = {
        create: function(name, pos, neg, lineNumber) {
            var o = new BlameObj(name, pos, neg, lineNumber);
            Object.freeze(o);
            return o;
        },
        clone: function(old, props) {
            var propsObj = {};
            for (var prop in props) {
                if (props.hasOwnProperty(prop)) {
                    propsObj[prop] = { value: props[prop] };
                }
            }
            var o = Object.create(old, propsObj);
            Object.freeze(o);
            return o;
        }
    };

    function BlameObj(name, pos, neg, lineNumber) {
        this.name = name;
        this.pos = pos;
        this.neg = neg;
        this.lineNumber = lineNumber;
    }
    BlameObj.prototype.swap = function() {
        return Blame.clone(this, {
            pos: this.neg,
            neg: this.pos
        });
    };
    BlameObj.prototype.addExpected = function(expected, override) {
        if (this.expected === undefined || override) {
            return Blame.clone(this, {
                expected: expected
            });
        }
        return Blame.clone(this, {});
    };
    BlameObj.prototype.addGiven = function(given) {
        return Blame.clone(this, {
            given: given
        });
    };
    BlameObj.prototype.addLocation = function(loc) {
        return Blame.clone(this, {
            loc: this.loc != null ? this.loc.concat(loc) : [loc]
        });
    };
    BlameObj.prototype.addParents = function(parent) {
        return Blame.clone(this, {
            parents: this.parents != null ? this.parents.concat(parent) : [parent]
        });
    };


    function assert(cond, msg) {
        if(!cond) {
            throw new Error(msg);
        }
    }


    class Contract {
        constructor(name, type, proj) {
            this.name = name;
            this.type = type;
            this.proj = proj;
        }

        toString() {
            return this.name;
        }
    }

    function addQuotes(val) {
        if (typeof val === "string") {
            return "'" + val + "'";
        }
        return val;
    }

    function raiseBlame(blame) {
        var lineMessage = blame.lineNumber !== undefined ?
                          "function " + blame.name + " guarded at line: " + blame.lineNumber + "\n"
                          : "";
        var msg = blame.name + ": contract violation\n" +
            "expected: " + blame.expected + "\n" +
            "given: " + addQuotes(blame.given) + "\n" +
           "in: " + blame.loc.slice().reverse().join("\n    ") + "\n" +
            "    " + blame.parents[0] + "\n" +
            lineMessage +
            "blaming: " + blame.pos + "\n";
        throw new Error(msg);
    }


    function check(predicate, name) {
        var c = new Contract(name, "check", function(blame) {
            return function(val) {
                if (predicate(val)) {
                    return val;
                } else {
                    raiseBlame(blame.addExpected(name).addGiven(val));
                }
            };
        });
        return c;
    }

    function addTh {
        0 => "0th",
        1 => "1st",
        2 => "2nd",
        3 => "3rd",
        (x) => x + "th"
    }

    function pluralize {
        (0, str) => str + "s",
        (1, str) => str,
        (n, str) => str + "s"
    }

    function fun(dom, rng, options) {

        var domName = "(" + dom.join(", ") + ")";
        var contractName = domName + " -> " + rng;

        var c = new Contract(contractName, "fun", function(blame) {
            return function(f) {
                blame = blame.addParents(contractName);
                if (typeof f !== "function") {
                    raiseBlame(blame.addExpected("a function that takes " +
                                                 dom.length + pluralize(dom.length, " argument"))
                                    .addGiven(f));
                }

                function applyTrap(target, thisVal, args) {

                    var checkedArgs = [];

                    for (var i = 0; i < dom.length; i++) {
                        if (dom[i].type === "optional" && args[i] === undefined) {
                            continue;
                        } else {
                            var domProj = dom[i].proj(blame.swap()
                                                      .addLocation("the " +
                                                                   addTh(i+1) +
                                                                   " argument of"));
                            checkedArgs.push(domProj(args[i]));

                        }
                    }
                    checkedArgs = checkedArgs.concat(args.slice(i));

                    assert(rng instanceof Contract, "The range is not a contract");

                    var rawResult = target.apply(thisVal, checkedArgs);
                    var rngProj = rng.proj(blame.addLocation("the return of"));
                    return rngProj(rawResult);
                }

                // only use expensive proxies when needed (to distinguish between apply and construct)
                if (options && options.needs_proxy) {
                    var p = new Proxy(f, {
                        apply: function(target, thisVal, args) {
                            return applyTrap(target, thisVal, args);
                        }
                    });

                    return p;

                } else {
                    return function() {
                        return applyTrap(f, this, Array.prototype.slice.call(arguments));
                    };
                }


            };
        });

        return c;
    }

    function optional(contract, options) {
        var contractName = "opt " + contract;
        return new Contract(contractName, "optional", function(blame) {
            return function(val) {
                var proj = contract.proj(blame);
                return proj(val);
            };
        });
    }

    function repeat(contract, options) {
        var contractName = "...." + contract;

        return new Contract(contractName, "repeat", function(blame) {
            return function (val) {
                var proj = contract.proj(blame);
                return proj(val);
            };
        });
    }

    function array(arrContract, options) {
        var proxyPrefix = options && options.proxy ? "!" : "";
        var contractName = proxyPrefix + "[" + arrContract.map(function(c) {
            return c;
        }).join(", ") + "]";

        var contractNum = arrContract.length;

        var c = new Contract(contractName, "array", function(blame) {
            return function(arr) {
                if (typeof arr === "number" ||
                    typeof arr === "string" ||
                    typeof arr === "boolean" || arr == null) {
                    raiseBlame(blame.addGiven(arr)
                                    .addExpected("an array with at least " +
                                                 contractNum + pluralize(contractNum, " field")));
                }
                for (var ctxIdx = 0, arrIdx = 0; ctxIdx < arrContract.length; ctxIdx++) {
                    if (arrContract[ctxIdx].type === "repeat" && arr.length <= ctxIdx) {
                        break;
                    }
                    var fieldProj = arrContract[ctxIdx].proj(blame.addLocation("the " +
                                                                               addTh(arrIdx) +
                                                                               " field of"));
                    var checkedField = fieldProj(arr[arrIdx]);
                    arr[arrIdx] = checkedField;

                    if (arrContract[ctxIdx].type === "repeat") {
                        if (ctxIdx !== arrContract.length - 1) {
                            throw new Error("The repeated contract must come last in " + contractName);
                        }
                        for (; arrIdx < arr.length; arrIdx++) {
                            var repeatProj = arrContract[ctxIdx].proj(blame.addLocation("the " +
                                                                                        addTh(arrIdx) +
                                                                                        " field of"));
                            arr[arrIdx] = repeatProj(arr[arrIdx]);
                        }
                    }
                    arrIdx++;
                }
                if (options && options.proxy) {
                    return new Proxy(arr, {
                        set: function(target, key, value) {
                            var lastContract = arrContract[arrContract.length - 1];
                            var fieldProj;
                            if (arrContract[key] !== undefined && arrContract[key].type !== "repeat") {
                                fieldProj = arrContract[key].proj(blame.swap()
                                                                  .addLocation("the " + addTh(key) +
                                                                               " field of"));
                                target[key] = fieldProj(value);
                            } else if (lastContract && lastContract.type === "repeat") {
                                fieldProj = lastContract.proj(blame.swap()
                                                                   .addLocation("the " + addTh(key) +
                                                                                " field of"));
                                target[key] = fieldProj(value);
                            }
                        }
                    });
                } else {
                    return arr;
                }
            };
        });
        return c;
    }

    function object(objContract, options) {
        var contractKeys = Object.keys(objContract);
        var proxyPrefix = options && options.proxy ? "!" : "";
        var contractName = proxyPrefix + "{" + contractKeys.map(function(prop) {
            return prop + ": " + objContract[prop];
        }).join(", ") + "}";
        var keyNum = contractKeys.length;

        var c = new Contract(contractName, "object", function(blame) {
            return function(obj) {
                if (typeof obj === "number" ||
                    typeof obj === "string" ||
                    typeof obj === "boolean" || obj == null) {
                    raiseBlame(blame.addGiven(obj)
                                    .addExpected("an object with at least " +
                                                 keyNum + pluralize(keyNum, " key")));
                }

                contractKeys.forEach(function(key) {
                    if (!(objContract[key].type === "optional" && obj[key] === undefined)) {
                        var propProj = objContract[key].proj(blame.addLocation("the " +
                                                                               key +
                                                                               " property of"));
                        var checkedProperty = propProj(obj[key]);
                        obj[key] = checkedProperty;
                    }
                });

                if (options && options.proxy) {
                    return new Proxy(obj, {
                        set: function(target, key, value) {
                            if (objContract.hasOwnProperty(key)) {
                                var propProj = objContract[key].proj(blame.swap()
                                                                     .addLocation("setting the " +
                                                                                  key + " property of"));
                                var checkedProperty = propProj(value);
                                target[key] = checkedProperty;
                            } else {
                                target[key] = value;
                            }
                        }
                    });
                } else {
                    return obj;
                }
            };
        });

        return c;
    }

    function or(left, right) {
        var contractName = left + " or " + right;
        return new Contract(contractName, "or", function(blame) {
            return function(val) {
                try {
                    var leftProj = left.proj(blame.addExpected(contractName, true));
                    return leftProj(val);
                } catch (b) {
                    var rightProj = right.proj(blame.addExpected(contractName, true));
                    return rightProj(val);
                }
            };
        });
    }

    function guard(contract, value, name) {
        var proj = contract.proj(Blame.create(name,
                                              "function " + name,
                                              "(calling context for " + name + ")"));
        return proj(value);
    }


    return {
        Num: check(function(val)       { return typeof val === "number"; }, "Num"),
        Str: check(function(val)       { return typeof val === "string"; }, "Str"),
        Bool: check(function(val)      { return typeof val === "boolean"; }, "Bool"),
        Odd: check(function(val)       { return (val % 2) === 1; }, "Odd"),
        Even: check(function(val)      { return (val % 2) !== 1; }, "Even"),
        Pos: check(function(val)       { return val >= 0; }, "Pos"),
        Nat: check(function(val)       { return val > 0; }, "Nat"),
        Neg: check(function(val)       { return val < 0; }, "Neg"),
        Any: check(function(val)       { return true; }, "Any"),
        None: check(function(val)      { return false; }, "None"),
        Null: check(function(val)      { return null === val; }, "Null"),
        Undefined: check(function(val) { return void 0 === val; }, "Null"),
        Void: check(function(val)      { return null == val; }, "Null"),

        // "type" variables
        // a: seal("a"),
        // b: seal("b"),
        // c: seal("c"),
        // d: seal("d"),
        // e: seal("e"),
        // f: seal("f"),
        // g: seal("g"),

        fun: fun,
        or: or,
        repeat: repeat,
        optional: optional,
        object: object,
        array: array,
        Blame: Blame,
        guard: guard
    };
})();
