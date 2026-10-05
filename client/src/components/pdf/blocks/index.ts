import { registerBlockForm } from '../formRegistry';
import { CharGridForm } from './CharGridForm';
import { InfoRowForm } from './InfoRowForm';
import { SignatureForm } from './SignatureForm';

/** Designer forms of the registered block types (each one pairs with a lib/pdf/blocks/* module) */
registerBlockForm('signature', SignatureForm);
registerBlockForm('infoRow', InfoRowForm);
registerBlockForm('charGrid', CharGridForm);
