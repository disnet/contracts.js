
macro toLibrary {
	rule { $lib { 
		($args ...) -> $rest ... 
	} } => {
		$lib.fun(
			[toLibrary $lib { $args ... }], 
			 toLibrary $lib {$rest ...})
	}

	rule { $lib {
		$contract , $rest ...
	} } => {
		toLibrary $lib { $contract } , toLibrary $lib { $rest ... }
	}

	rule { $lib {
		$contract
	} } => {
		$lib.$contract
	}
}


let @ = macro {
	case {_
		$lib { $contracts ... } 
		function $name ($params ...) { $body ...}
	} => { 


		return #{
			$lib.guard(
				toLibrary $lib { $contracts ... },
				function $name ($params ...) { $body ...}
			);
		}
	}
}
export @;