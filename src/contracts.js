(function() {
    "use strict";
    if (typeof require === "function") {
        // importing patches Proxy to be in line with the new direct proxies
        require("harmony-reflect");
    }
    operator (|?|) 4 left {$l, $r} => #{ typeof $l !== 'undefined' ? $l : $r }

    var unproxy = new WeakMap();
    var typeVarMap = new WeakMap();

    var Blame = {
        create: function(name, pos, neg, lineNumber) {
            var o = new BlameObj(name, pos, neg, lineNumber);
            return o;
        },
        clone: function(old, props) {
            var o = new BlameObj(props.name |?| old.name,
                                 props.pos |?| old.pos,
                                 props.neg |?| old.neg,
                                 props.lineNuber |?| old.lineNumber);
            o.expected = props.expected |?| old.expected;
            o.given    = props.given |?| old.given;
            o.loc      = props.loc |?| old.loc;
            o.parents  = props.parents |?| old.parents;
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
            loc: this.loc !== undefined ? this.loc.concat(loc) : [loc]
        })
        ;
    };
    BlameObj.prototype.addParents = function(parent) {
        return Blame.clone(this, {
            parents: this.parents !== undefined ? this.parents.concat(parent) : [parent]
        });
    };

    BlameObj.prototype.setNeg = function(neg) {
        return Blame.clone(this, {
            neg: neg
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
            this.proj = proj.bind(this);
        }

        closeCycle(contract) {
            this.cycleContract = contract;
            return contract;
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

    function makeCoffer(name) {
        return new Contract(name, "coffer", function(blame, unwrapTypeVar) {
            return function(val) {
                var locationMsg = "in the type variable " + name + " of";
                if (unwrapTypeVar) {
                    if (val && typeof val === "object" && unproxy.has(val)) {
                        var unwraperProj = typeVarMap.get(this).contract.proj(blame.addLocation(locationMsg));
                        return unwraperProj(unproxy.get(val));
                    } else {
                        raiseBlame(blame.addExpected("an opaque value")
                                        .addGiven(val)
                                        .addLocation(locationMsg));
                    }
                } else {
                    var towrap = val && typeof val === "object" ? val : {};
                    var p = new Proxy(towrap, {
                        getOwnPropertyDescriptor: function() {
                            raiseBlame(blame.swap()
                                            .addExpected("value to not be manipulated")
                                            .addGiven("called Object.getOwnPropertyDescriptor")
                                            .addLocation(locationMsg));
                        },
                        getOwnPropertyName: function() {
                            raiseBlame(blame.swap()
                                            .addExpected("value to not be manipulated")
                                            .addGiven("called Object.getOwnPropertyName")
                                            .addLocation(locationMsg));
                        },
                        defineProperty: function() {
                            raiseBlame(blame.swap()
                                            .addExpected("value to not be manipulated")
                                            .addGiven("called Object.defineProperty")
                                            .addLocation(locationMsg));
                        },
                        deleteProperty: function(target, propName) {
                            raiseBlame(blame.swap()
                                            .addExpected("value to not be manipulated")
                                            .addGiven("called delete on property" + propName)
                                            .addLocation(locationMsg));
                        },
                        freeze: function() {
                            raiseBlame(blame.swap()
                                            .addExpected("value to not be manipulated")
                                            .addGiven("called Object.freeze")
                                            .addLocation(locationMsg));
                        },
                        seal: function() {
                            raiseBlame(blame.swap()
                                            .addExpected("value to not be manipulated")
                                            .addGiven("called Object.seal")
                                            .addLocation(locationMsg));
                        },
                        preventExtensions: function() {
                            raiseBlame(blame.swap()
                                            .addExpected("value to not be manipulated")
                                            .addGiven("called Object.preventExtensions")
                                            .addLocation(locationMsg));
                        },
                        has: function(target, propName) {
                            raiseBlame(blame.swap()
                                            .addExpected("value to not be manipulated")
                                            .addGiven("called `in` for property " + propName)
                                            .addLocation(locationMsg));
                        },
                        hasOwn: function(target, propName) {
                            raiseBlame(blame.swap()
                                            .addExpected("value to not be manipulated")
                                            .addGiven("called Object.hasOwnProperty on property " + propName)
                                            .addLocation(locationMsg));
                        },

                        get: function(target, propName) {
                            var givenMsg = "performed obj." + propName;
                            if (propName === "valueOf") {
                                givenMsg = "attempted to inspect the value";
                            }
                            raiseBlame(blame.swap()
                                            .addExpected("value to not be manipulated")
                                            .addGiven(givenMsg)
                                            .addLocation(locationMsg));
                        },
                        set: function(target, propName, val) {
                            raiseBlame(blame.swap()
                                            .addExpected("value to not be manipulated")
                                            .addGiven("performed obj." + propName + " = " + val)
                                            .addLocation(locationMsg));
                        },

                        enumerate: function() {
                            raiseBlame(blame.swap()
                                            .addExpected("value to not be manipulated")
                                            .addGiven("value used in a `for in` loop")
                                            .addLocation(locationMsg));
                        },
                        iterate: function() {
                            raiseBlame(blame.swap()
                                            .addExpected("value to not be manipulated")
                                            .addGiven("value used in a `for of` loop")
                                            .addLocation(locationMsg));
                        },
                        keys: function() {
                            raiseBlame(blame.swap()
                                            .addExpected("value to not be manipulated")
                                            .addGiven("called Object.keys")
                                            .addLocation(locationMsg));
                        },

                        apply: function() {
                            raiseBlame(blame.swap()
                                            .addExpected("value to not be manipulated")
                                            .addGiven("attempted to invoke the value")
                                            .addLocation(locationMsg));
                        },
                        construct: function() {
                            raiseBlame(blame.swap()
                                            .addExpected("value to not be manipulated")
                                            .addGiven("attempted to invoke the value with new")
                                            .addLocation(locationMsg));
                        }
                    });

                    if (!typeVarMap.has(this)) {
                        var valType = typeof val;
                        var inferedContract = check(function(checkVal) {
                            return (typeof checkVal) === valType;
                        }, "(x) => typeof x === '" + valType + "'");
                        typeVarMap.set(this, {
                            contract: inferedContract
                        });
                    } else {
                        var inferedProj = typeVarMap.get(this).contract.proj(blame.addLocation(locationMsg));
                        inferedProj(val);
                    }
                    unproxy.set(p, val);
                    return p;
                }
            }.bind(this);
        });
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

    function pluralize(a0, str) {
        return a0 === 1 ? str : (str + "s");
    }

    function toContract(f) {
        return check(f, if f.name then f.name else "custom contract");
    }


    //first two params get partial eval'd
    function applyTrap (funParams, contractParams, target, thisVal, args) {

        var options = funParams.options;
        var dom     = funParams.dom;
        var rng     = funParams.rng;

        var blame           = contractParams.blame;
        var unwrapTypeVar   = contractParams.unwrapTypeVar;
        var projOptions     = contractParams.projOptions;

        var checkedArgs = [];
        var depArgs = [];
        for (var i = 0; i < dom.length; i++) {
            if (dom[i].type === "optional" && args[i] === undefined) {
                continue;
            }

            var location = "the " + addTh(i+1) + " argument of";
            var unwrapForProj = dom[i].type === "fun" ? !unwrapTypeVar : unwrapTypeVar;
            var domProj = dom[i].proj(blame.swap()
                                      .addLocation(location), unwrapForProj);

            checkedArgs.push(domProj(args[i]));

            if (options && options.dependency) {
                var depProj = dom[i].proj(blame.swap()
                                               .setNeg("the contract of " + blame.name)
                                               .addLocation(location));
                depArgs.push(depProj(args[i]));
            }

        }
        checkedArgs = checkedArgs.concat(args.slice(i));
        var checkedThis = thisVal;
        if((options && options.thisContract) || (projOptions && projOptions.overrideThisContract)) {
            var thisContract = if projOptions && projOptions.overrideThisContract
                               then projOptions.overrideThisContract
                               else options.thisContract
            var thisProj = thisContract.proj(blame.swap()
                                                  .addLocation("the this value of"));
            checkedThis = thisProj(thisVal);
        }

        assert(rng instanceof Contract, "The range is not a contract");

        var rawResult = target.apply(checkedThis, checkedArgs);
        var rngUnwrap = rng.type === "fun" ? unwrapTypeVar : !unwrapTypeVar;
        var rngProj = rng.proj(blame.addLocation("the return of"), rngUnwrap);
        var rngResult = rngProj(rawResult);
        if (options && options.dependency && typeof options.dependency === "function") {
            var depResult = options.dependency.apply({}, depArgs.concat(rngResult));
            if (!depResult) {
                raiseBlame(blame.addExpected(options.dependencyStr)
                                .addGiven(false)
                                .addLocation("the return dependency of"));
            }
        }

        return rngResult;
    }



    function fun(domRaw, rngRaw, options) {
        var dom = domRaw.map(function(d) {
            if (!(d instanceof Contract)) {
                if (typeof d === "function") {
                    return toContract(d);
                }
                throw new Error(d + " is not a contract");
            }
            return d;
        });
        var domStr = dom.map(function (d, idx) {
            return options && options.namesStr ? options.namesStr[idx] + ": " + d : d;
        }).join(", ");
        var domName = "(" + domStr + ")";

        var rng = rngRaw;
        if (!(rngRaw instanceof Contract)) {
            if (typeof rngRaw === "function") {
                rng = toContract(rngRaw);
            } else {
                throw new Error(rng + " is not a contract");
            }
        }

        var rngStr = options && options.namesStr ? options.namesStr[options.namesStr.length - 1] + ": " + rng : rng;
        var thisName = options && options.thisContract ? "\n    | this: " + options.thisContract : "";

        var contractName = domName  + " -> " + rngStr + thisName +
            (options && options.dependencyStr ? " | " + options.dependencyStr : "");

        var c = new Contract(contractName, "fun", function(blame, unwrapTypeVar, projOptions) {

            return function(f) {
                blame = blame.addParents(contractName);
                if (typeof f !== "function") {
                    raiseBlame(blame.addExpected("a function that takes " +
                                                 dom.length + pluralize(dom.length, " argument"))
                                    .addGiven(f));
                }

                var applyTrapPartial =
                    applyTrap.bind('',
                        {options: options, dom: dom, rng: rng},
                        {blame: blame, unwrapTypeVar: unwrapTypeVar, projOptions: projOptions});

                // only use expensive proxies when needed (to distinguish between apply and construct)
                if (options && options.needsProxy) {
                    var p = new Proxy(f, {
                        apply: function(target, thisVal, args) {
                            return applyTrapPartial(target, thisVal, args);
                        }
                    });

                    return p;

                } else {
                    return function() {
                        return applyTrapPartial(f, this, Array.prototype.slice.call(arguments));
                    };
                }


            };
        });

        return c;
    }

    function optional(contract) {
        if (!(contract instanceof Contract)) {
            if (typeof contract === "function") {
                contract = toContract(contract);
            } else {
                throw new Error(contract + " is not a contract");
            }
        }
        var contractName = "?" + contract;
        return new Contract(contractName, "optional", function(blame, unwrapTypeVar) {
            return function(val) {
                var proj = contract.proj(blame, unwrapTypeVar);
                return proj(val);
            };
        });
    }

    function repeat(contract) {
        if (!(contract instanceof Contract)) {
            if (typeof contract === "function") {
                contract = toContract(contract);
            } else {
                throw new Error(contract + " is not a contract");
            }
        }
        var contractName = "...." + contract;

        return new Contract(contractName, "repeat", function(blame, unwrapTypeVar) {
            return function (val) {
                var proj = contract.proj(blame, unwrapTypeVar);
                return proj(val);
            };
        });
    }


    function arrayContractHandler (options, arrContract, contractName, contractNum, blame, unwrapTypeVar) {
        return function(arr) {
            if (typeof arr === "number" ||
                typeof arr === "string" ||
                typeof arr === "boolean" || arr === null || arr ===  undefined) {
                raiseBlame(blame.addGiven(arr)
                                .addExpected("an array with at least " +
                                             contractNum + pluralize(contractNum, " field")));
            }
            for (var ctxIdx = 0, arrIdx = 0; ctxIdx < arrContract.length; ctxIdx++) {
                if (arrContract[ctxIdx].type === "repeat" && arr.length <= ctxIdx) {
                    break;
                } else if (arrContract[ctxIdx].type === "repeat" && ctxIdx !== arrContract.length - 1) {
                    throw new Error("The repeated contract must come last in " + contractName);
                }
                var unwrapForProj = arrContract[ctxIdx].type === "fun" ? !unwrapTypeVar : unwrapTypeVar;
                var fieldProj = arrContract[ctxIdx].proj(blame.addLocation("the " +
                                                                           addTh(arrIdx) +
                                                                           " field of"),
                                                         unwrapForProj);
                var checkedField = fieldProj(arr[arrIdx]);
                arr[arrIdx] = checkedField;

                arrIdx++;

                if (arrContract[ctxIdx].type !== "repeat") {
                    continue;
                }
                for (; arrIdx < arr.length; arrIdx++) {
                    var repeatProj = arrContract[ctxIdx].proj(blame.addLocation("the " +
                                                                                addTh(arrIdx) +
                                                                                " field of"),
                                                              unwrapForProj);
                    arr[arrIdx] = repeatProj(arr[arrIdx]);
                }

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
    }

    function array(arrContractRaw, options) {
        var proxyPrefix = options && options.proxy ? "!" : "";
        var arrContract = arrContractRaw.map(function(c) {
            if (!(c instanceof Contract)) {
                if (typeof c === "function") {
                    return toContract(c);
                }
                throw new Error(c + " is not a contract");
            }
            return c;
        });
        var contractName = proxyPrefix + "[" + arrContract.map(function(c) {
            return c;
        }).join(", ") + "]";

        var contractNum = arrContract.length;

        return new Contract(contractName, "array",
            arrayContractHandler.bind('', options, arrContract, contractName, contractNum));
    }

    function object(objContract, options) {
        var contractKeys = Object.keys(objContract);
        contractKeys.forEach(function (prop) {
            if (!(objContract[prop] instanceof Contract)) {
                if (typeof objContract[prop] === "function") {
                    objContract[prop] = toContract(objContract[prop]);
                } else {
                    throw new Error(objContract[prop] + " is not a contract");
                }
            }
        });
        var proxyPrefix = options && options.proxy ? "!" : "";
        var contractName = proxyPrefix + "{" + contractKeys.map(function(prop) {
            return prop + ": " + objContract[prop];
        }).join(", ") + "}";
        var keyNum = contractKeys.length;

        var c = new Contract(contractName, "object", function(blame) {
            return function(obj) {
                if (typeof obj === "number" ||
                    typeof obj === "string" ||
                    typeof obj === "boolean" || obj === null || obj === undefined) {
                    raiseBlame(blame.addGiven(obj)
                                    .addExpected("an object with at least " +
                                                 keyNum + pluralize(keyNum, " key")));
                }

                contractKeys.forEach(function(key) {
                    if (!(objContract[key].type === "optional" && obj[key] === undefined)) {
                        var propProjOptions = if objContract[key].type === "fun"
                                              then {overrideThisContract: this}
                                              else {}
                        var c = if objContract[key].type === "cycle"
                                   then objContract[key].cycleContract
                                   else objContract[key];
                        var propProj = c.proj(blame.addLocation("the " +
                                                                key +
                                                                " property of"), false, propProjOptions);
                        var checkedProperty = propProj(obj[key]);
                        obj[key] = checkedProperty;
                    }
                }.bind(this));

                if (options && options.proxy) {
                    return new Proxy(obj, {
                        set: function(target, key, value) {
                            if (objContract.hasOwnProperty(key)) {
                                var c = if objContract[key].type === "cycle"
                                           then objContract[key].cycleContract
                                           else objContract[key];
                                var propProj = c.proj(blame.swap()
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
            }.bind(this);
        });

        return c;
    }

    function reMatch(re) {
        var contractName = re.toString();
        return check(function(val) {
            return re.test(val);
        }, contractName);
    }

    function and(left, right) {
        if (!(left instanceof Contract)) {
            if (typeof left === "function") {
                left = toContract(left);
            } else {
                throw new Error(left + " is not a contract");
            }
        }
        if (!(right instanceof Contract)) {
            if (typeof right === "function") {
                right = toContract(right);
            } else {
                throw new Error(right + " is not a contract");
            }
        }

        var contractName = left + " and " + right;
        return new Contract(contractName, "and", function(blame) {
            return function(val) {
                var leftProj = left.proj(blame.addExpected(contractName, true));
                var leftResult = leftProj(val);
                var rightProj = right.proj(blame.addExpected(contractName, true));
                return rightProj(leftResult);
            };
        })
    }


    function or(left, right) {
        if (!(left instanceof Contract)) {
            if (typeof left === "function") {
                left = toContract(left);
            } else {
                throw new Error(left + " is not a contract");
            }
        }
        if (!(right instanceof Contract)) {
            if (typeof right === "function") {
                right = toContract(right);
            } else {
                throw new Error(right + " is not a contract");
            }
        }
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


    function cyclic(name) {
        return new Contract(name, "cycle", function() {
            throw new Error("Stub, should never be called");
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
        Any: check(function()       { return true; }, "Any"),
        None: check(function()      { return false; }, "None"),
        Null: check(function(val)      { return null === val; }, "Null"),
        Undefined: check(function(val) { return void 0 === val; }, "Null"),
        Void: check(function(val)      { return null === val || undefined === val; }, "Null"),

        check: check,
        reMatch: reMatch,
        fun: fun,
        or: or,
        and: and,
        repeat: repeat,
        optional: optional,
        object: object,
        array: array,
        cyclic: cyclic,
        Blame: Blame,
        makeCoffer: makeCoffer,
        guard: guard
    };
})();
