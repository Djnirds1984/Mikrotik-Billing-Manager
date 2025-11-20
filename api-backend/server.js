
        const schedulerName = `deactivate-dhcp-${address.replace(/\./g, '-')}`;
        const scriptSource = `:log info "DHCP subscription expired for ${address}, deactivating."; ` +
            `/ip firewall address-list remove [find where address="${address}" and list="authorized-dhcp-users"]; ` +
            `/ip firewall connection remove [find where src-address~"^${address}"]; ` +
            `:local macAddr "${macAddress}"; ` +
            `:local leaseId [/ip dhcp-server lease find where mac-address=$macAddr]; ` +
            `if ([:len $leaseId] > 0) do={ ` +
                `:local ipAddr [/ip dhcp-server lease get $leaseId address]; ` +
                `/ip firewall address-list add address=$ipAddr list="pending-dhcp-users" timeout=1d comment=$macAddr; ` +
            `}`;

        const commentData = { 
            customerInfo, 
            contactNumber, 
            email, 
            planName: planNameForComment, 
            dueDate: expiresAt.toISOString().split('T')[0],
            dueDateTime: expiresAt.toISOString()
        };
        const addressListPayload = {
            list: 'authorized-dhcp-users',
            comment: JSON.stringify(commentData),
            address: address,
        };

        if (req.routerConfig.api_type === 'legacy') {
