const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fix() {
  console.log('Fetching active automations...');
  const { data: automations } = await supabase.from('automations').select('*');
  console.log('Current automations:', automations);

  for (const a of automations) {
    if (a.trigger_type === 'order_confirmed') {
      console.log(`Fixing automation ${a.id}: changing trigger to 'order_placed'`);
      await supabase.from('automations').update({ trigger_type: 'order_placed' }).eq('id', a.id);
    }
  }

  const { data: updated } = await supabase.from('automations').select('*');
  console.log('Updated automations:', updated);
}

fix().catch(console.error);
