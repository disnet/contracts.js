macro to_str {
  case { _ ($tok) } => {
    return [makeValue(#{$tok}.map(unwrapSyntax).join(''), #{ here })];
  }
}

macro @ {
	rule { $dom -> $rng 
		   function $name ($params ...) { $body ... } 
	} => {
	   	function $name ($params ...) {
		   	var fn = function ($params ...) { $body ... }
		   	var params = [$dom(arguments[0], to_str($name))];
		   	var ret = fn.apply(this, params);
		   	return $rng(ret, to_str($name));
	   	}
	}
}
