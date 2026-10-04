// OPTIONAL one-line insurance (see swf-patches/README.md). In frame_13 / DoAction, directly AFTER the line
//
//     es.addListener(this);
//
// add this block. In real Flash Player it behaves exactly like the built-in default (onData -> onXML ->
// XMLReceived); it only matters if Ruffle does not turn plain-text game messages ("CA|...") into onXML calls.
es.onData = function(src)
{
   if(src.substr(0,1) == "<")
   {
      es.XMLReceived(new XML(src));
   }
   else
   {
      es.XMLReceived(src);
   }
};
