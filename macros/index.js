var _c;
let import = macro {
    rule { @ from $lib:lit } => {
        _c = (function () {
    'use strict';
    if (typeof require === 'function') {
        // importing patches Proxy to be in line with the new direct proxies
        require('harmony-reflect');
    }
    var Blame = {
            create: function (name, pos, neg) {
                var o = new BlameObj(name, pos, neg);
                Object.freeze(o);
                return o;
            },
            clone: function (old, props) {
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
    function BlameObj(name, pos, neg, expected, given) {
        this.name = name;
        this.pos = pos;
        this.neg = neg;
    }
    BlameObj.prototype.swap = function () {
        return Blame.clone(this, {
            pos: this.neg,
            neg: this.pos
        });
    };
    BlameObj.prototype.addExpected = function (expected) {
        return Blame.clone(this, { expected: expected });
    };
    BlameObj.prototype.addGiven = function (given) {
        return Blame.clone(this, { given: given });
    };
    BlameObj.prototype.addLocation = function (loc) {
        return Blame.clone(this, { loc: this.loc != null ? this.loc.concat(loc) : [loc] });
    };
    BlameObj.prototype.addParents = function (parent) {
        return Blame.clone(this, { parents: this.parents != null ? this.parents.concat(parent) : [parent] });
    };
    function assert(cond, msg) {
        if (!cond) {
            throw new Error(msg);
        }
    }
    var unproxy = new WeakMap();
    function Contract(name, type, proj) {
        this.name = name;
        this.type = type;
        this.proj = proj;
    }
    Contract.prototype.toString = function toString() {
        return this.name;
    };
    function addQuotes(val) {
        if (typeof val === 'string') {
            return '\'' + val + '\'';
        }
        return val;
    }
    function raiseBlame(blame) {
        var msg = blame.name + ': contract violation\n' + 'expected: ' + blame.expected + '\n' + 'given: ' + addQuotes(blame.given) + '\n' + 'in: ' + blame.loc.slice().reverse().join('\n    ') + '\n' + '    ' + blame.parents[0] + '\n' + 'blaming: ' + blame.pos + '\n';
        throw new Error(msg);
    }
    function check(predicate, name) {
        var c = new Contract(name, 'check', function (blame) {
                return function (val) {
                    if (predicate(val)) {
                        return val;
                    } else {
                        raiseBlame(blame.addExpected(name).addGiven(val));
                    }
                };
            });
        return c;
    }
    function addTh(a0) {
        if (a0 === 0) {
            return '0th';
        }
        if (a0 === 1) {
            return '1st';
        }
        if (a0 === 2) {
            return '2nd';
        }
        if (a0 === 3) {
            return '3rd';
        }
        var x = a0;
        return x + 'th';
    }
    function pluralize(a0, a1) {
        if (a0 === 0) {
            var str = a1;
            return str + 's';
        }
        if (a0 === 1) {
            var str = a1;
            return str;
        }
        var n = a0;
        var str = a1;
        return str + 's';
    }
    function fun(dom, rng, options) {
        var domName = '(' + dom.join(', ') + ')';
        var contractName = domName + ' -> ' + rng;
        var c = new Contract(contractName, 'fun', function (blame) {
                return function (f) {
                    blame = blame.addParents(contractName);
                    if (typeof f !== 'function') {
                        raiseBlame(blame.addExpected('a function that takes ' + dom.length + pluralize(dom.length, ' argument')).addGiven(f));
                    }
                    /* options:
                   pre: ({} -> Bool) - function to check preconditions
                   post: ({} -> Bool) - function to check postconditions
                   this: {...} - object contract to check 'this'
                */
                    function applyTrap(target, thisVal, args) {
                        var checkedArgs = [];
                        for (var i = 0; i < args.length; i++) {
                            if (dom[i]) {
                                var domProj = dom[i].proj(blame.swap().addLocation('the ' + addTh(i + 1) + ' argument of'));
                                checkedArgs.push(domProj(args[i]));
                            } else {
                                checkedArgs.push(args[i]);
                            }
                        }
                        assert(rng instanceof Contract, 'The range is not a contract');
                        var rawResult = target.apply(thisVal, checkedArgs);
                        var rngProj = rng.proj(blame.addLocation('the return of'));
                        return rngProj(rawResult);
                    }
                    var p = new Proxy(f, { apply: applyTrap });
                    unproxy.set(p, this);
                    return p;
                };
            });
        return c;
    }
    function repeat(contract, options) {
        var contractName = '....' + contract;
        return new Contract(contractName, 'repeat', function (blame) {
            return function (val) {
                var proj = contract.proj(blame);
                return proj(val);
            };
        });
    }
    function array(arrContract, options) {
        var contractName = '[' + arrContract.map(function (c$2) {
                return c$2;
            }).join(', ') + ']';
        var contractNum = arrContract.length;
        var c = new Contract(contractName, 'array', function (blame) {
                return function (arr) {
                    if (typeof arr === 'number' || typeof arr === 'string' || typeof arr === 'boolean') {
                        raiseBlame(blame.addGiven(arr).addExpected('an array with at least ' + contractNum + pluralize(contractNum, ' fields')));
                    }
                    for (var ctxIdx = 0, arrIdx = 0; ctxIdx < arrContract.length; ctxIdx++) {
                        if (arrContract[ctxIdx].type === 'repeat' && arr.length <= ctxIdx) {
                            break;
                        }
                        var fieldProj = arrContract[ctxIdx].proj(blame.addLocation('the ' + addTh(arrIdx) + ' field of'));
                        var checkedField = fieldProj(arr[arrIdx]);
                        arr[arrIdx] = checkedField;
                        if (arrContract[ctxIdx].type === 'repeat') {
                            if (ctxIdx !== arrContract.length - 1) {
                                throw new Error('The repeated contract must come last in ' + contractName);
                            }
                            for (; arrIdx < arr.length; arrIdx++) {
                                var repeatProj = arrContract[ctxIdx].proj(blame.addLocation('the ' + addTh(arrIdx) + ' field of'));
                                arr[arrIdx] = repeatProj(arr[arrIdx]);
                            }
                        }
                        arrIdx++;
                    }
                    if (options && options.proxy) {
                        return new Proxy(arr, {
                            set: function (target, key, value) {
                                var lastContract = arrContract[arrContract.length - 1];
                                var fieldProj$2;
                                if (arrContract[key] !== undefined && arrContract[key].type !== 'repeat') {
                                    fieldProj$2 = arrContract[key].proj(blame.swap().addLocation('the ' + addTh(key) + ' field of'));
                                    target[key] = fieldProj$2(value);
                                } else if (lastContract && lastContract.type === 'repeat') {
                                    fieldProj$2 = lastContract.proj(blame.swap().addLocation('the ' + addTh(key) + ' field of'));
                                    target[key] = fieldProj$2(value);
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
        var contractName = '{' + contractKeys.map(function (prop) {
                return prop + ': ' + objContract[prop];
            }).join(', ') + '}';
        var keyNum = contractKeys.length;
        var c = new Contract(contractName, 'object', function (blame) {
                return function (obj) {
                    if (typeof obj === 'number' || typeof obj === 'string' || typeof obj === 'boolean') {
                        raiseBlame(blame.addGiven(obj).addExpected('an object with at least ' + keyNum + pluralize(keyNum, ' key')));
                    }
                    contractKeys.forEach(function (key) {
                        var propProj = objContract[key].proj(blame.addLocation('the ' + key + ' property of'));
                        var checkedProperty = propProj(obj[key]);
                        obj[key] = checkedProperty;
                    });
                    if (options && options.proxy) {
                        return new Proxy(obj, {
                            set: function (target, key, value) {
                                if (objContract.hasOwnProperty(key)) {
                                    var propProj = objContract[key].proj(blame.swap().addLocation('setting the ' + key + ' property of'));
                                    var checkedProperty = propProj(value);
                                    target[key] = checkedProperty;
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
    function guard(contract, value, name) {
        var proj = contract.proj(Blame.create(name, 'function ' + name, '(calling context for ' + name + ')'));
        return proj(value);
    }
    return {
        Num: check(function (val) {
            return typeof val === 'number';
        }, 'Num'),
        Str: check(function (val) {
            return typeof val === 'string';
        }, 'Str'),
        Bool: check(function (val) {
            return typeof val === 'boolean';
        }, 'Bool'),
        Odd: check(function (val) {
            return val % 2 === 1;
        }, 'Odd'),
        Even: check(function (val) {
            return val % 2 !== 1;
        }, 'Even'),
        Pos: check(function (val) {
            return val >= 0;
        }, 'Pos'),
        Nat: check(function (val) {
            return val > 0;
        }, 'Nat'),
        Neg: check(function (val) {
            return val < 0;
        }, 'Neg'),
        Any: check(function (val) {
            return true;
        }, 'Any'),
        None: check(function (val) {
            return false;
        }, 'None'),
        Null: check(function (val) {
            return null === val;
        }, 'Null'),
        Undefined: check(function (val) {
            return void 0 === val;
        }, 'Null'),
        Void: check(function (val) {
            return null == val;
        }, 'Null'),
        fun: fun,
        repeat: repeat,
        object: object,
        array: array,
        Blame: Blame,
        guard: guard
    };
}());
    }
    rule { $rest ... } => {
        import $rest ...
    }
}
export import;

macro toLibrary {
    // function
    rule { {
		($args ...) -> $rest ...
	} } => {
        _c.fun(
            [toLibrary { $args ... }],
             toLibrary {$rest ...})
    }

    // object
    rule { {
        { $($key $[:] $contract ...) (,) ... }
    } } => {
        _c.object({
            $($key $[:] toLibrary { $contract ...}) (,) ...
        })

    }

    // proxied object
    rule { {
        !{ $($key $[:] $contract ...) (,) ... }
    } } => {
        _c.object({
            $($key $[:] toLibrary { $contract ...}) (,) ...
        }, {proxy: true})

    }

    // array
    rule { {
        [ $contracts ... ]
    } } => {
        _c.array([toLibrary { $contracts ...} ])

    }

    // proxied array
    rule { {
        ![ $contracts ... ]
    } } => {
        _c.array([toLibrary { $contracts ...} ], {proxy: true})

    }

    rule { {
        $contract ... , $rest ...
	} } => {
        toLibrary { $contract ... } , toLibrary { $rest ... }
    }

    rule { {
        $[...] $contract ...
    } } => {
        _c.repeat(toLibrary { $contract ... })
    }

    rule { {
		$contract
	} } => {
        _c.$contract
	}
}



let @ = macro {
	case {_
        $contracts ...
		function $name ($params ...) { $body ...}
    } => {
        var nameStr = unwrapSyntax(#{$name});
        letstx $guardedName = [makeIdent("inner_" + nameStr, #{here})];
        letstx $client = [makeValue("function " + nameStr, #{here})];
        letstx $server = [makeValue("(calling context for " + nameStr + ")", #{here})];
        letstx $fnName = [makeValue(nameStr, #{here})];
		return #{
            var $guardedName = (toLibrary { $contracts ... }).proj(_c.Blame.create($fnName, $client, $server))(function $name ($params ...) { $body ...});
            function $name ($params ...) {
                return $guardedName.apply(this, arguments);
            }
        }
	}
}
export @;
