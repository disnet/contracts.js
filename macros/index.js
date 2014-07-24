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
            create: function (pos, neg) {
                var o = new BlameObj(pos, neg);
                Object.freeze(o);
                return o;
            }
        };
    function BlameObj(pos, neg) {
        this.pos = pos;
        this.neg = neg;
    }
    BlameObj.prototype.swap = function () {
        return Blame.create(this.neg, this.pos);
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
    function blame(toblame, other, contract, value) {
        var promisedContract;
        var msg = toblame + ': broke its contract\n' + 'promised: ' + contract + '\n' + 'produced: ' + value + '\n' + 'which is not: ' + contract + '\n' + 'in: ' + other + '\n' + 'blaming: ' + toblame;
        var e = new Error(msg);
        throw e;
    }
    function blameRng(violatedContract, funContract, pos, neg, value) {
        var valueStr = typeof value === 'string' ? '\'' + value + '\'' : value;
        var msg = pos + ': broke its contract\n' + 'promised: ' + violatedContract + '\n' + 'produced: ' + valueStr + '\n' + 'in the range of:\n' + funContract + '\n' + 'contract from: ' + pos + '\n' + 'blaming: ' + pos;
        var e = new Error(msg);
        e.pos = pos;
        e.neg = neg;
        throw e;
    }
    function blameDom(violatedContract, funContract, pos, neg, value, position) {
        var positionStr = position === 1 ? '1st' : position === 2 ? '2nd' : position === 3 ? '3rd' : position + 'th';
        var valueStr = typeof value === 'string' ? '\'' + value + '\'' : value;
        var msg = neg + ': contract violation\n' + 'expected: ' + violatedContract + '\n' + 'given: ' + valueStr + '\n' + 'in the ' + positionStr + ' argument of:\n' + funContract + '\n' + 'contract from: ' + neg + '\n' + 'blaming: ' + pos;
        var e = new Error(msg);
        e.pos = pos;
        e.neg = neg;
        throw e;
    }
    function blameObj(violatedContract, objContract, pos, neg, key, value) {
        var valueStr = typeof value === 'string' ? '\'' + value + '\'' : value;
        var msg = neg + ': contract violation\n' + 'expected: ' + violatedContract + '\n' + 'in property: ' + key + '\n' + 'but actually: ' + valueStr + '\n' + 'in the contract:\n' + objContract + '\n' + 'contract from: ' + neg + '\n' + 'blaming: ' + pos;
        var e = new Error(msg);
        e.pos = pos;
        e.neg = neg;
        throw e;
    }
    function raiseBlame() {
        return blameDom.apply(this, arguments);
    }
    function check(predicate, name) {
        var c = new Contract(name, 'check', function (blame$2) {
                return function (val) {
                    if (predicate(val)) {
                        return val;
                    } else {
                        raiseBlame(blame$2, null, this, val);
                    }
                };
            });
        return c;
    }
    function fun(dom, rng, options) {
        var domName = '(' + dom.join(',') + ')';
        var contractName = domName + ' -> ' + rng;
        var c = new Contract(contractName, 'fun', function (blame$2) {
                return function (f) {
                    if (typeof f !== 'function') {
                        raiseBlame(blame$2, this, f);
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
                                var domProj = dom[i].proj(blame$2.swap());
                                checkedArgs.push(domProj(args[i]));
                            } else {
                                checkedArgs.push(args[i]);
                            }
                        }
                        assert(rng instanceof Contract, 'The range is not a contract');
                        var rawResult = target.apply(thisVal, checkedArgs);
                        var rngProj = rng.proj(blame$2);
                        return rngProj(rawResult);
                    }
                    var p = new Proxy(f, { apply: applyTrap });
                    unproxy.set(p, this);
                    return p;
                };
            });
        return c;
    }
    function object(objContract, options) {
        var contractKeys = Object.keys(objContract);
        var contractName = '{' + contractKeys.map(function (prop) {
                return prop + ': ' + objContract[prop];
            }).join(', ') + '}';
        var c = new Contract(contractName, 'object', function (blame$2) {
                return function (obj) {
                    contractKeys.forEach(function (key) {
                        var propProj = objContract[key].proj(blame$2);
                        var checkedProperty = propProj(obj[key]);
                        obj[key] = checkedProperty;
                    });
                    return obj;
                };
            });
        return c;
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
        object: object,
        Blame: Blame
    };
}());
    }
    rule { $rest ... } => {
        import $rest ...
    }
}
export import;

macro toLibrary {
    rule { {
		($args ...) -> $rest ...
	} } => {
        _c.fun(
            [toLibrary { $args ... }],
             toLibrary {$rest ...})
	}

    rule { {
        { $($key $[:] $contract) (,) ... }
    } } => {
        _c.object({
            $($key $[:] toLibrary { $contract }) (,) ...
        })

    }

    rule { {
		$contract , $rest ...
	} } => {
        toLibrary { $contract } , toLibrary { $rest ... }
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
		return #{
            var $guardedName = (toLibrary { $contracts ... }).proj(_c.Blame.create($client, $server))(function $name ($params ...) { $body ...});
            function $name ($params ...) {
                return $guardedName.apply(this, arguments);
            }
        }
	}
}
export @;
